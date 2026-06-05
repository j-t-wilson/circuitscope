import { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import { normalizeCircuitData } from '../utils/normalizeData.js';
import { EXAMPLE_CIRCUITS, DEFAULT_EXAMPLE_ID, getDefaultCircuit } from '../exampleCircuits.js';
import { playStartupSound, initAudioContext } from '../utils/startupSound.js';
import { useTheme } from './ThemeContext.jsx';

const CircuitContext = createContext(null);

const DEFAULT_CIRCUIT = getDefaultCircuit();

export function CircuitProvider({ children }) {
  const { isDark } = useTheme();
  const [data, setData] = useState(null);
  const [selectedDetector, setSelectedDetector] = useState(null);
  const [hoveredDetector, setHoveredDetector] = useState(null);
  const [viewMode, setViewMode] = useState('timeline');
  const [zoom, setZoom] = useState(0.7);
  const [showDetectingRegions, setShowDetectingRegions] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Try loading circuit_data.json on mount (CLI workflow)
  useEffect(() => {
    fetch('/circuit_data.json', { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('missing circuit_data.json');
        return res.json();
      })
      .then((json) => {
        setData(normalizeCircuitData(json));
        setShowLoadModal(false);
      })
      .catch(() => {
        // No circuit_data.json - stay on launch window
      });
  }, []);

  const handleLoadCircuit = useCallback(async (circuitText) => {
    // Init audio context immediately during user gesture (before async ops)
    // This ensures Safari allows audio playback after the fetch completes
    initAudioContext();
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
      setData(normalizeCircuitData(result));
      setShowLoadModal(false);
      setSelectedDetector(null);
      playStartupSound(isDark);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [isDark]);

  const clearLoadError = useCallback(() => {
    setLoadError(null);
  }, []);

  const resetToLaunch = useCallback(() => {
    setData(null);
    setSelectedDetector(null);
    setShowLoadModal(true);
    setLoadError(null);
  }, []);

  // Derived state: relevant errors for selected detector
  const relevantErrors = useMemo(() => {
    if (!data || !selectedDetector) return [];
    return data.detector_errors.filter(e =>
      e.dem_terms.some(t => t.target === selectedDetector)
    );
  }, [selectedDetector, data]);

  // Derived state: highlighted operations
  const highlighted = useMemo(() => {
    const s = new Set();
    relevantErrors.forEach(e => e.locations.forEach(l => {
      l.qubits.forEach(q => s.add(`${l.tick}-${q}-${l.name}-${l.rate}`));
    }));
    return s;
  }, [relevantErrors]);

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
    viewMode, setViewMode,
    zoom, setZoom,
    showDetectingRegions, setShowDetectingRegions,
    showLoadModal, setShowLoadModal,
    isLoading,
    loadError,
    // Derived
    relevantErrors,
    highlighted,
    highlightedMeasurements,
    // Actions
    handleLoadCircuit,
    clearLoadError,
    resetToLaunch,
    // Constants
    examples: EXAMPLE_CIRCUITS,
    defaultExampleId: DEFAULT_EXAMPLE_ID,
    defaultCircuit: DEFAULT_CIRCUIT,
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
