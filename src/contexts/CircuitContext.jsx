import { createContext, useContext, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { normalizeCircuitData } from '../utils/normalizeData.js';
import { EXAMPLE_CIRCUITS } from '../exampleCircuits.js';
import { playStartupSound, initAudioContext } from '../utils/startupSound.js';
import { readShareState, writeShareState, readLastCircuit, saveLastCircuit } from '../utils/shareState.js';
import { buildComparison, parseMeasuredData, readStoredMeasuredData, saveStoredMeasuredData } from '../utils/measuredData.js';
import { computeEventFraction } from '../utils/eventFraction.js';
import { useTheme } from './ThemeContext.jsx';

const CircuitContext = createContext(null);

export function CircuitProvider({ children }) {
  const { isDark } = useTheme();
  const [data, setData] = useState(null);
  const [selectedDetector, setSelectedDetector] = useState(null);
  const [hoveredDetector, setHoveredDetector] = useState(null);
  const [hoveredMechanism, setHoveredMechanism] = useState(null);
  const [viewMode, setViewMode] = useState('timeline');
  const [zoom, setZoom] = useState(0.7);
  const [showDetectingRegions, setShowDetectingRegions] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showNoiseModal, setShowNoiseModal] = useState(false);
  // Launch modal shown over a loaded workspace (logo click). The workspace
  // stays intact until a new circuit is actually analyzed.
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Measured per-detector event fractions: { shots: number|null, fractions: {D0: 0.012, ...} }
  const [measuredData, setMeasuredData] = useState(null);
  // Shared parameter overrides ({param_name: value}), written by the Analysis
  // sliders and the Compare view's Try/Apply buttons, read by every surface.
  // Parameter names are stable across detectors (derived from gate type and
  // original rate), so overrides survive switching detectors and views, and
  // carry across live edits while their parameters still exist in the circuit;
  // they reset on a fresh load from the launch modal.
  const [modifiedValues, setModifiedValues] = useState({});
  // Transient notice when a live edit drops overrides whose parameters no
  // longer exist in the edited circuit: { dropped: [param names] } | null
  const [overrideNotice, setOverrideNotice] = useState(null);
  // Average-formula response for the current circuit: global parameter list
  // plus the per-detector count matrix (detector_counts), which lets every
  // detector's event fraction be recomputed client-side under modified
  // parameters — and is exactly the matrix the measured-data fit needs.
  const [formulaModel, setFormulaModel] = useState(null);
  // Last analyzed circuit, used to prefill the launch modal after a fresh visit
  const [lastCircuit] = useState(() => readLastCircuit());
  // Detector to select once an auto-loaded (shared URL) circuit finishes analyzing
  const pendingDetectorRef = useRef(null);
  // Measured dataset (from the CLI --data flag) to apply once the auto-loaded
  // circuit finishes analyzing; takes precedence over carried/stored data
  const pendingMeasuredRef = useRef(null);
  // Live-edit (Code view) re-analysis: status of the debounced analyze call,
  // and which detector fractions the last applied edit changed.
  const [editStatus, setEditStatus] = useState('idle'); // 'idle' | 'analyzing' | 'error'
  const [editError, setEditError] = useState(null);
  // { changed: [{name, before, after}], added: [name], removed: [name] } | null
  const [fractionDeltas, setFractionDeltas] = useState(null);
  // Monotonic id so a superseded in-flight edit analysis can't apply late
  const editRequestRef = useRef(0);
  // Monte Carlo verification sample (server-side detector sampling), keyed to
  // the circuit text it was drawn from so edits invalidate it implicitly:
  // { circuitText, shots, fractions: {D0: 0.012, ...} } | null
  const [mcData, setMcData] = useState(null);
  const [mcStatus, setMcStatus] = useState('idle'); // 'idle' | 'sampling' | 'error'
  const [mcError, setMcError] = useState(null);
  const mcRequestRef = useRef(0);
  // Error propagation overlay (timeline): which error channel instance is
  // toggled, its DEM-backed Pauli components, and the tick-by-tick frames of
  // the active component (fetched from /api/propagate, cached per circuit).
  // { key, source: {tick, name, rate, qubits}, components: [{pauli, detectors}],
  //   activePauli, frames, flippedMeasurements, flippedDetectors, status, error }
  const [propagation, setPropagation] = useState(null);
  const propagationCacheRef = useRef(new Map());
  // /api/formula responses keyed by detector id, self-invalidating when the
  // circuit text changes, so detector hopping in the Analysis view is instant.
  const formulaCacheRef = useRef({ circuit: null, byDetector: new Map() });

  const getCachedFormula = useCallback((circuitText, detectorId) => {
    const cache = formulaCacheRef.current;
    return cache.circuit === circuitText ? (cache.byDetector.get(detectorId) ?? null) : null;
  }, []);

  const cacheFormula = useCallback((circuitText, detectorId, result) => {
    if (formulaCacheRef.current.circuit !== circuitText) {
      formulaCacheRef.current = { circuit: circuitText, byDetector: new Map() };
    }
    formulaCacheRef.current.byDetector.set(detectorId, result);
  }, []);

  const handleLoadCircuit = useCallback(async (circuitText, { silent = false } = {}) => {
    // Init audio context immediately during user gesture (before async ops)
    // This ensures Safari allows audio playback after the fetch completes
    if (!silent) initAudioContext();
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuit_text: circuitText })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to analyze circuit');
      }
      const normalized = normalizeCircuitData(result);
      // A fresh load supersedes any in-flight live edit and its change flags
      editRequestRef.current += 1;
      setEditStatus('idle');
      setEditError(null);
      setFractionDeltas(null);
      setData(normalized);
      const pending = pendingDetectorRef.current;
      pendingDetectorRef.current = null;
      setSelectedDetector(
        pending && normalized.detectors?.some(d => d.name === pending) ? pending : null
      );
      // Carry measured data across re-analysis (the model-tweaking loop), or
      // restore the stored dataset when this exact circuit was measured before.
      // Drop it if the new circuit's detector set no longer covers the data.
      const detectorNames = new Set((normalized.detectors || []).map(d => d.name));
      const pendingMeasured = pendingMeasuredRef.current;
      pendingMeasuredRef.current = null;
      setMeasuredData(prev => {
        let candidate = pendingMeasured || prev;
        if (!candidate) {
          const stored = readStoredMeasuredData();
          if (stored && stored.circuit === circuitText) {
            candidate = { shots: stored.shots ?? null, fractions: stored.fractions };
          }
        }
        if (!candidate) return null;
        const covered = Object.keys(candidate.fractions).every(name => detectorNames.has(name));
        return covered ? candidate : null;
      });
      // A fresh load is a new workspace: parameter overrides never carry,
      // even if the new circuit happens to share parameter names.
      setModifiedValues({});
      setOverrideNotice(null);
      saveLastCircuit(circuitText);
      setShowLoadModal(false);
      if (!silent) playStartupSound(isDark);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [isDark]);

  // On mount: restore a shared circuit from the URL hash, otherwise ask the
  // server for a CLI-provided circuit (circuitscope mycircuit.stim [--data])
  useEffect(() => {
    const shared = readShareState();
    if (shared?.circuit) {
      pendingDetectorRef.current = shared.detector;
      handleLoadCircuit(shared.circuit, { silent: true });
      return;
    }
    fetch('/api/initial', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('no initial circuit');
        return res.json();
      })
      .then((json) => {
        if (!json?.circuit_text) throw new Error('no initial circuit');
        if (json.measured_text) {
          try {
            const parsed = parseMeasuredData(json.measured_text);
            pendingMeasuredRef.current = { shots: parsed.shots ?? null, fractions: parsed.fractions };
          } catch (err) {
            console.warn(`Ignoring --data file: ${err.message}`);
          }
        }
        handleLoadCircuit(json.circuit_text, { silent: true });
      })
      .catch(() => {
        // No CLI circuit — stay on the launch window
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL hash in sync so the current circuit (and selected detector)
  // survives refresh and can be shared as a link
  useEffect(() => {
    if (!data) return;
    writeShareState(data.circuit_text, selectedDetector);
  }, [data, selectedDetector]);

  // Logo click: open the launch modal over the intact workspace. Nothing is
  // cleared — analyzing a new circuit replaces the workspace, Cancel returns
  // to the loaded circuit untouched.
  const openLoadModal = useCallback(() => {
    setLoadError(null);
    setShowLoadModal(true);
  }, []);
  const closeLoadModal = useCallback(() => setShowLoadModal(false), []);

  // Re-analyze an edited circuit text (Code view live editing) without the
  // fresh-load ceremony: stays silent, keeps the selection when its detector
  // survives, keeps measured data while it still covers the detector set, and
  // records which detector fractions the edit changed. On analyze errors the
  // last good analysis stays on screen.
  const handleLiveEdit = useCallback(async (circuitText) => {
    if (!data) return;
    if (circuitText === data.circuit_text) {
      // Edit was reverted (or a no-op); clear any stale error state
      editRequestRef.current += 1;
      setEditStatus('idle');
      setEditError(null);
      return;
    }
    const requestId = ++editRequestRef.current;
    setEditStatus('analyzing');
    setEditError(null);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuit_text: circuitText })
      });
      const result = await response.json();
      if (requestId !== editRequestRef.current) return;
      if (!response.ok) {
        throw new Error(result.error || 'Failed to analyze circuit');
      }
      const normalized = normalizeCircuitData(result);
      // Diff detector fractions against the outgoing analysis so the UI can
      // flag what this edit changed
      const before = new Map(data.detectors.map(d => [d.name, d.event_fraction || 0]));
      const newNames = new Set(normalized.detectors.map(d => d.name));
      const changed = [];
      const added = [];
      normalized.detectors.forEach(d => {
        if (!before.has(d.name)) {
          added.push(d.name);
          return;
        }
        const prev = before.get(d.name);
        const next = d.event_fraction || 0;
        if (Math.abs(next - prev) > 1e-12) changed.push({ name: d.name, before: prev, after: next });
      });
      const removed = data.detectors.filter(d => !newNames.has(d.name)).map(d => d.name);
      setFractionDeltas({ changed, added, removed });
      setData(normalized);
      setEditStatus('idle');
      setSelectedDetector(prev => (prev && newNames.has(prev) ? prev : null));
      setMeasuredData(prev => {
        if (!prev) return null;
        const covered = Object.keys(prev.fractions).every(name => newNames.has(name));
        return covered ? prev : null;
      });
      saveLastCircuit(circuitText);
    } catch (err) {
      if (requestId !== editRequestRef.current) return;
      setEditStatus('error');
      setEditError(err.message);
    }
  }, [data]);

  // Monte Carlo verify: sample the circuit server-side so the detector panel
  // can overlay sampled fractions ± error bars next to the analytical ones.
  const runMonteCarlo = useCallback(async (shots) => {
    if (!data) return;
    const circuitText = data.circuit_text;
    const requestId = ++mcRequestRef.current;
    setMcStatus('sampling');
    setMcError(null);
    try {
      const response = await fetch('/api/montecarlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuit_text: circuitText, shots }),
      });
      const result = await response.json();
      if (requestId !== mcRequestRef.current) return;
      if (!response.ok) {
        throw new Error(result.error || 'Sampling failed');
      }
      const fractions = {};
      result.fractions.forEach((f, i) => { fractions[`D${i}`] = f; });
      setMcData({ circuitText, shots: result.shots, fractions });
      setMcStatus('idle');
    } catch (err) {
      if (requestId !== mcRequestRef.current) return;
      setMcStatus('error');
      setMcError(err.message);
    }
  }, [data]);

  const clearMonteCarlo = useCallback(() => {
    mcRequestRef.current += 1;
    setMcData(null);
    setMcStatus('idle');
    setMcError(null);
  }, []);

  // A circuit change supersedes any in-flight sampling run and stale error;
  // the sample itself is invalidated by its circuitText key, not cleared.
  useEffect(() => {
    mcRequestRef.current += 1;
    setMcStatus('idle');
    setMcError(null);
  }, [data?.circuit_text]);

  // Fetch (or reuse) the tick-by-tick frames for one Pauli component of the
  // toggled error channel. The setter guard keys results to the propagation
  // they were requested for, so a stale response can't apply.
  const loadPropagationFrames = useCallback(async (key, source, pauli) => {
    const circuitText = data?.circuit_text;
    if (!circuitText) return;
    const cacheKey = `${key}|${pauli}`;
    const apply = (payload) => setPropagation(prev => (
      prev && prev.key === key && prev.activePauli === pauli
        ? {
            ...prev,
            frames: payload.frames,
            flippedMeasurements: payload.flipped_measurements,
            flippedDetectors: payload.flipped_detectors.map(i => `D${i}`),
            status: 'ready',
          }
        : prev
    ));
    const cached = propagationCacheRef.current.get(cacheKey);
    if (cached) {
      apply(cached);
      return;
    }
    try {
      const response = await fetch('/api/propagate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuit_text: circuitText,
          tick: source.tick,
          name: source.name,
          qubits: source.qubits,
          pauli,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Propagation failed');
      propagationCacheRef.current.set(cacheKey, result);
      apply(result);
    } catch (err) {
      setPropagation(prev => (
        prev && prev.key === key && prev.activePauli === pauli
          ? { ...prev, status: 'error', error: err.message }
          : prev
      ));
    }
  }, [data?.circuit_text]);

  // Toggle the propagation overlay for an error channel instance clicked on
  // the timeline. Components are the distinct flipped Pauli products the DEM
  // attributes to this instance, each with the detectors it flips.
  const toggleErrorPropagation = useCallback((source) => {
    if (!data) return;
    const qubits = [...source.qubits].sort((a, b) => a - b);
    const key = `${source.tick}|${source.name}|${qubits.join(',')}`;
    if (propagation?.key === key) {
      setPropagation(null);
      return;
    }
    const qubitsKey = qubits.join(',');
    const componentMap = new Map();
    data.detector_errors.forEach(err => {
      err.locations.forEach(l => {
        if (l.tick !== source.tick || l.name !== source.name) return;
        if ([...l.qubits].sort((a, b) => a - b).join(',') !== qubitsKey) return;
        if (!l.pauli || l.pauli.includes('NO_PAULI')) return;
        const entry = componentMap.get(l.pauli) || { pauli: l.pauli, detectors: new Set() };
        err.dem_terms.forEach(t => {
          if (t.target?.startsWith('D')) entry.detectors.add(t.target);
        });
        componentMap.set(l.pauli, entry);
      });
    });
    const components = [...componentMap.values()]
      .map(c => ({
        pauli: c.pauli,
        detectors: [...c.detectors].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
      }))
      .sort((a, b) => a.pauli.localeCompare(b.pauli, undefined, { numeric: true }));
    const activePauli = components[0]?.pauli ?? null;
    setPropagation({
      key,
      source: { ...source, qubits },
      components,
      activePauli,
      frames: null,
      flippedMeasurements: null,
      flippedDetectors: components[0]?.detectors ?? [],
      status: activePauli ? 'loading' : 'ready',
      error: null,
    });
    if (activePauli) loadPropagationFrames(key, { ...source, qubits }, activePauli);
  }, [data, propagation?.key, loadPropagationFrames]);

  const selectPropagationComponent = useCallback((pauli) => {
    if (!propagation || propagation.activePauli === pauli) return;
    const component = propagation.components.find(c => c.pauli === pauli);
    if (!component) return;
    setPropagation({
      ...propagation,
      activePauli: pauli,
      frames: null,
      flippedMeasurements: null,
      flippedDetectors: component.detectors,
      status: 'loading',
      error: null,
    });
    loadPropagationFrames(propagation.key, propagation.source, pauli);
  }, [propagation, loadPropagationFrames]);

  const clearPropagation = useCallback(() => setPropagation(null), []);

  // The overlay describes one specific circuit: drop it (and the frame
  // cache) whenever the analyzed circuit text changes.
  useEffect(() => {
    setPropagation(null);
    propagationCacheRef.current = new Map();
  }, [data?.circuit_text]);

  // Import (or clear) measured data for the current circuit.
  const applyMeasuredData = useCallback((measured) => {
    setMeasuredData(measured);
    if (!measured) saveStoredMeasuredData(null, null);
  }, []);

  // Persist the dataset together with the circuit it is being compared
  // against (covers fresh imports and retention across model tweaks), so a
  // reload of the same circuit restores the comparison.
  useEffect(() => {
    if (data && measuredData) saveStoredMeasuredData(data.circuit_text, measuredData);
  }, [data, measuredData]);

  // Fetch the global parameter model (average formula) for each analyzed
  // circuit. Parameter overrides are NOT blanket-reset here: live edits carry
  // them over for every parameter name that survives in the new model (names
  // encode gate type + original rate, so they are stable across unrelated
  // edits); the rest are dropped with a transient notice. Fresh loads reset
  // explicitly in handleLoadCircuit.
  useEffect(() => {
    setFormulaModel(null);
    if (!data?.circuit_text) {
      setModifiedValues({});
      return undefined;
    }
    let cancelled = false;
    fetch('/api/formula', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circuit_text: data.circuit_text, detector_id: -1 }),
    })
      .then(res => res.json())
      .then(result => {
        if (cancelled || result.error || !result.detector_counts) return;
        setFormulaModel(result);
        cacheFormula(data.circuit_text, -1, result);
        const names = new Set(result.parameters.map(p => p.name));
        setModifiedValues(prev => {
          const dropped = Object.keys(prev).filter(name => !names.has(name));
          if (dropped.length === 0) return prev;
          setOverrideNotice({ dropped });
          return Object.fromEntries(Object.entries(prev).filter(([name]) => names.has(name)));
        });
      })
      .catch(() => {
        // Formula generation is best-effort; surfaces fall back to backend fractions.
      });
    return () => { cancelled = true; };
  }, [data, cacheFormula]);

  const clearOverrideNotice = useCallback(() => setOverrideNotice(null), []);

  const hasModifiedParams = Object.keys(modifiedValues).length > 0;

  // Detectors with event fractions reflecting the current parameter
  // overrides. Without overrides this is the backend's analysis verbatim, so
  // there is no analytical-vs-client drift in the default view.
  const liveDetectors = useMemo(() => {
    if (!data) return [];
    if (!hasModifiedParams || !formulaModel) return data.detectors;
    const params = formulaModel.parameters.map(p => ({
      ...p,
      value: modifiedValues[p.name] ?? p.original_value,
    }));
    return data.detectors.map(d => ({
      ...d,
      event_fraction: computeEventFraction(
        params.map(p => ({ ...p, count: formulaModel.detector_counts[p.name]?.[d.id] ?? 0 }))
      ),
    }));
  }, [data, formulaModel, modifiedValues, hasModifiedParams]);

  // Derived state: measured-vs-model statistics per detector with data,
  // tracking parameter overrides live.
  const comparison = useMemo(
    () => (data ? buildComparison(liveDetectors, measuredData) : null),
    [data, liveDetectors, measuredData]
  );

  // Sampled-vs-analytical statistics for the Monte Carlo verify overlay. The
  // sample is of the circuit as written, so it is always compared against the
  // nominal backend fractions (not slider overrides) — same z-score math as
  // the measured-data comparison, with the sampled fraction as "measured".
  const mcComparison = useMemo(() => {
    if (!data || !mcData || mcData.circuitText !== data.circuit_text) return null;
    return buildComparison(data.detectors, mcData);
  }, [data, mcData]);

  const monteCarlo = useMemo(() => ({
    comparison: mcComparison,
    shots: mcComparison ? mcData.shots : null,
    status: mcStatus,
    error: mcError,
    run: runMonteCarlo,
    clear: clearMonteCarlo,
  }), [mcComparison, mcData, mcStatus, mcError, runMonteCarlo, clearMonteCarlo]);

  // Derived state: relevant errors for selected detector
  const relevantErrors = useMemo(() => {
    if (!data || !selectedDetector) return [];
    return data.detector_errors.filter(e =>
      e.dem_terms.some(t => t.target === selectedDetector)
    );
  }, [selectedDetector, data]);

  // Derived state: highlighted operations
  // When a mechanism card is hovered in the sidebar, narrow the highlight to
  // just that mechanism's error locations ({name, qubits}; qubits null means
  // the card aggregates all locations of that gate).
  const highlighted = useMemo(() => {
    const s = new Set();
    relevantErrors.forEach(e => e.locations.forEach(l => {
      if (hoveredMechanism) {
        if (l.name !== hoveredMechanism.name) return;
        if (hoveredMechanism.qubits && !hoveredMechanism.qubits.every(q => l.qubits.includes(q))) return;
      }
      l.qubits.forEach(q => s.add(`${l.tick}-${q}-${l.name}-${l.rate}`));
    }));
    return s;
  }, [relevantErrors, hoveredMechanism]);

  // Derived state: highlighted measurements
  const highlightedMeasurements = useMemo(() => {
    if (!data || !selectedDetector) return new Set();
    const detector = data.detectors.find(d => d.name === selectedDetector);
    if (!detector?.measurement_indices) return new Set();
    const s = new Set();
    detector.measurement_indices.forEach(idx => {
      const meas = data.measurements[idx];
      if (meas) s.add(`${meas.tick}-${meas.qubit}`);
    });
    return s;
  }, [selectedDetector, data]);

  const value = {
    // State
    data,
    selectedDetector, setSelectedDetector,
    hoveredDetector, setHoveredDetector,
    hoveredMechanism, setHoveredMechanism,
    viewMode, setViewMode,
    zoom, setZoom,
    showDetectingRegions, setShowDetectingRegions,
    showImportModal, setShowImportModal,
    showNoiseModal, setShowNoiseModal,
    showLoadModal,
    isLoading,
    loadError,
    lastCircuit,
    measuredData,
    modifiedValues, setModifiedValues,
    overrideNotice, clearOverrideNotice,
    formulaModel,
    getCachedFormula, cacheFormula,
    editStatus,
    editError,
    fractionDeltas,
    // Derived
    liveDetectors,
    hasModifiedParams,
    comparison,
    monteCarlo,
    relevantErrors,
    highlighted,
    highlightedMeasurements,
    propagation,
    // Actions
    toggleErrorPropagation,
    selectPropagationComponent,
    clearPropagation,
    handleLoadCircuit,
    handleLiveEdit,
    openLoadModal,
    closeLoadModal,
    applyMeasuredData,
    // Constants
    examples: EXAMPLE_CIRCUITS,
  };

  return (
    <CircuitContext.Provider value={value}>
      {children}
    </CircuitContext.Provider>
  );
}

export function useCircuit() {
  const context = useContext(CircuitContext);
  if (!context) {
    throw new Error('useCircuit must be used within a CircuitProvider');
  }
  return context;
}
