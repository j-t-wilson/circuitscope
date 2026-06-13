import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useCircuit } from '../../contexts/CircuitContext.jsx';
import {
  computeEventFraction,
  computeAverageEventFraction,
  computeSensitivities,
  computeAverageSensitivities,
  computeContributions,
  computeAverageContributions,
} from '../../utils/eventFraction.js';
import ParameterInput from './ParameterInput.jsx';
import SweepChart from './SweepChart.jsx';
import ExportMenu from '../ExportMenu.jsx';
import { GLOBAL_SCALE, paramsAtSweep } from '../../utils/sweep.js';

export default function AnalysisView({ data, selectedDetector, setSelectedDetector }) {
  const { C } = useTheme();
  // Parameter overrides are shared app-wide (sliders here, Try/Apply in the
  // Compare view, live fractions in the detector panel) and reset on circuit load.
  const { modifiedValues, setModifiedValues, getCachedFormula, cacheFormula } = useCircuit();
  const [formulaData, setFormulaData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);
  const [sortColumn, setSortColumn] = useState('count');
  const [sortDirection, setSortDirection] = useState('desc');
  // Which knob the sweep chart plots: a parameter name, GLOBAL_SCALE, or null
  const [sweepParam, setSweepParam] = useState(null);

  useEffect(() => {
    if (!selectedDetector || !data.circuit_text) {
      setFormulaData(null);
      return;
    }

    const detectorId = selectedDetector === 'Average' ? -1 : parseInt(selectedDetector.replace('D', ''), 10);

    // Responses are cached per circuit in CircuitContext (same pattern as the
    // propagation frame cache), so revisiting a detector is instant.
    const cached = getCachedFormula(data.circuit_text, detectorId);
    if (cached) {
      setFormulaData(cached);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/formula', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        circuit_text: data.circuit_text,
        detector_id: detectorId,
      }),
    })
      .then(res => res.json())
      .then(result => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          setFormulaData(null);
        } else {
          cacheFormula(data.circuit_text, detectorId, result);
          setFormulaData(result);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setFormulaData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedDetector, data.circuit_text, getCachedFormula, cacheFormula]);

  const currentParams = useMemo(() => {
    if (!formulaData?.parameters) return [];
    return formulaData.parameters.map(p => ({
      ...p,
      value: modifiedValues[p.name] ?? p.original_value,
    }));
  }, [formulaData, modifiedValues]);

  // Only sweep a knob that exists in the current formula (the parameter set
  // changes with the selected detector); GLOBAL_SCALE is always valid.
  const activeSweep =
    sweepParam === GLOBAL_SCALE || currentParams.some(p => p.name === sweepParam)
      ? sweepParam
      : null;

  // Event fraction under arbitrary parameter values, for the current selection
  // (average over detector_counts when "Average" is selected). Drives both the
  // live readout below and the sweep chart.
  const evaluateFraction = useMemo(() => {
    if (formulaData?.detector_counts && formulaData?.num_detectors) {
      return (params) =>
        computeAverageEventFraction(params, formulaData.detector_counts, formulaData.num_detectors);
    }
    return (params) => computeEventFraction(params);
  }, [formulaData]);

  const { currentEventFraction, currentSensitivities, currentContributions } = useMemo(() => {
    if (!currentParams.length) return { currentEventFraction: 0, currentSensitivities: [], currentContributions: [] };

    if (formulaData?.detector_counts && formulaData?.num_detectors) {
      const ef = computeAverageEventFraction(currentParams, formulaData.detector_counts, formulaData.num_detectors);
      const sens = computeAverageSensitivities(currentParams, formulaData.detector_counts, formulaData.num_detectors);
      const contrib = computeAverageContributions(currentParams, formulaData.detector_counts, formulaData.num_detectors);
      return { currentEventFraction: ef, currentSensitivities: sens, currentContributions: contrib };
    }

    const ef = computeEventFraction(currentParams);
    const sens = computeSensitivities(currentParams);
    const contrib = computeContributions(currentParams);
    return { currentEventFraction: ef, currentSensitivities: sens, currentContributions: contrib };
  }, [currentParams, formulaData]);

  const sensitivityMap = useMemo(() => {
    const map = {};
    currentParams.forEach((p, i) => {
      map[p.name] = currentSensitivities[i] ?? 0;
    });
    return map;
  }, [currentParams, currentSensitivities]);

  const contributionMap = useMemo(() => {
    const map = {};
    currentParams.forEach((p, i) => {
      map[p.name] = currentContributions[i] ?? 0;
    });
    return map;
  }, [currentParams, currentContributions]);

  const handleCopy = async () => {
    if (!formulaData?.python_code) return;
    try {
      await navigator.clipboard.writeText(formulaData.python_code);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  // Click-to-set on the sweep chart: write the shared overrides. A global ×k
  // click replaces all overrides with a uniform scale of nominal (clamped at
  // each gate's physical maximum, same as the sliders).
  const handleSweepSet = (x) => {
    if (activeSweep === GLOBAL_SCALE) {
      setModifiedValues(Object.fromEntries(
        paramsAtSweep(currentParams, GLOBAL_SCALE, x).map(p => [p.name, p.value])
      ));
    } else if (activeSweep) {
      setModifiedValues(prev => ({ ...prev, [activeSweep]: x }));
    }
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedParams = useMemo(() => {
    if (!currentParams.length) return [];
    return [...currentParams].sort((a, b) => {
      let aVal, bVal;
      switch (sortColumn) {
        case 'sensitivity':
          aVal = sensitivityMap[a.name] ?? 0;
          bVal = sensitivityMap[b.name] ?? 0;
          break;
        case 'contribution':
          aVal = contributionMap[a.name] ?? 0;
          bVal = contributionMap[b.name] ?? 0;
          break;
        case 'value':
          aVal = a.value;
          bVal = b.value;
          break;
        case 'count':
          aVal = a.gate_count ?? a.count;
          bVal = b.gate_count ?? b.count;
          break;
        default:
          return 0;
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [currentParams, sensitivityMap, contributionMap, sortColumn, sortDirection]);

  const isAverageSelected = selectedDetector === 'Average';

  // Parameter table as displayed: current (possibly overridden) values plus
  // the derived sensitivity/contribution columns for the selected detector.
  const getParameterTable = () => ({
    columns: [
      { key: 'name', label: 'name' },
      { key: 'gate', label: 'gate' },
      { key: 'value', label: 'value' },
      { key: 'original_value', label: 'original_value' },
      { key: 'count', label: 'count' },
      { key: 'sensitivity', label: 'sensitivity' },
      { key: 'contribution', label: 'contribution' },
    ],
    rows: sortedParams.map(p => ({
      name: p.name,
      gate: p.gate_type,
      value: p.value,
      original_value: p.original_value,
      count: p.gate_count ?? p.count,
      sensitivity: sensitivityMap[p.name] ?? 0,
      contribution: contributionMap[p.name] ?? 0,
    })),
  });

  const chipStyle = (active, tone = 'detector') => {
    const color = tone === 'accent' ? C.accent : C.detector;
    const bright = tone === 'accent' ? C.accent : C.detectorBright;
    return {
      padding: '7px 10px',
      background: active ? `linear-gradient(180deg, ${bright}, ${color})` : C.field,
      color: active ? C.bg : (tone === 'accent' ? C.accent : C.text),
      border: `1px solid ${active ? bright : C.line}`,
      borderRadius: 8,
      cursor: 'pointer',
      fontSize: 11,
      fontFamily: 'var(--mono)',
      fontWeight: active ? 800 : 650,
      minHeight: 31,
    };
  };

  const sectionTitle = (label, extra = null) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 9 }}>
      <h3 className="display-title" style={{ margin: 0, fontSize: 17, color: C.text }}>{label}</h3>
      {extra}
    </div>
  );

  const detectorGrid = (
    <div style={{
      marginBottom: 18,
      padding: 14,
      background: `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
    }}>
      {sectionTitle('Select detector', (
        <span style={{ color: C.textDim, fontSize: 11, fontFamily: 'var(--mono)' }}>
          {data.detectors.length} detectors
        </span>
      ))}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        <button
          onClick={() => setSelectedDetector(isAverageSelected ? null : 'Average')}
          style={chipStyle(isAverageSelected, 'accent')}
        >
          Average
        </button>
        {data.detectors.map(d => {
          const isSelected = selectedDetector === d.name;
          return (
            <button
              key={d.id}
              onClick={() => setSelectedDetector(isSelected ? null : d.name)}
              style={chipStyle(isSelected)}
            >
              {d.name}
            </button>
          );
        })}
      </div>
    </div>
  );

  const statusPanel = (content, tone = 'neutral') => {
    const border = tone === 'error' ? C.error : C.line;
    const bg = tone === 'error' ? C.errorSoft : C.field;
    return (
      <div style={{
        padding: 20,
        textAlign: 'center',
        color: tone === 'error' ? C.error : C.textDim,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
      }}>
        {content}
      </div>
    );
  };

  const status =
    !selectedDetector ? statusPanel(
      <>
        <p style={{ margin: '0 0 8px', color: C.text }}>Select a detector to generate its analytical event fraction formula.</p>
        <p style={{ fontSize: 12, margin: 0 }}>
          Parameters are grouped by unique error mechanism and original value in the Stim circuit.
        </p>
      </>
    )
    : loading ? statusPanel('Generating formula...')
    : error ? statusPanel(<span>Error: {error}</span>, 'error')
    : !formulaData ? statusPanel('No formula data available.')
    : null;

  if (status) {
    return (
      <div>
        {detectorGrid}
        {status}
      </div>
    );
  }

  const hasModifications = Object.keys(modifiedValues).length > 0;
  const originalEF = formulaData.original_event_fraction;
  const percentChange = originalEF > 0 ? ((currentEventFraction - originalEF) / originalEF) * 100 : 0;

  const sortMarker = (column) => sortColumn === column ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '';

  const thStyle = {
    padding: '9px 11px',
    textAlign: 'left',
    color: C.textDim,
    fontWeight: 700,
    borderBottom: `1px solid ${C.line}`,
    background: C.fieldAlt,
    whiteSpace: 'nowrap',
  };

  return (
    <div>
      {detectorGrid}

      <div style={{
        marginBottom: 16,
        padding: 14,
        background: `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
        border: `1px solid ${hasModifications ? C.warning : C.line}`,
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: isAverageSelected ? C.accent : C.detectorBright, fontWeight: 800, fontFamily: 'var(--mono)' }}>
              {isAverageSelected ? 'Average (all detectors)' : selectedDetector}
            </div>
            <div style={{ color: C.textDim, fontSize: 11, marginTop: 3 }}>
              Event fraction response
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {hasModifications ? (
              <div style={{ color: C.text, whiteSpace: 'nowrap' }}>
                <span style={{ color: C.textDim, fontFamily: 'var(--mono)', fontSize: 12, textDecoration: 'line-through' }}>
                  {(originalEF * 100).toFixed(4)}%
                </span>
                <span style={{ margin: '0 6px', color: C.textDim }}>to</span>
                <span style={{ color: C.warning, fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800 }}>
                  {(currentEventFraction * 100).toFixed(4)}%
                </span>
                <span style={{
                  marginLeft: 7,
                  fontSize: 11,
                  color: percentChange > 0 ? C.error : C.success,
                  fontFamily: 'var(--mono)',
                }}>
                  ({percentChange > 0 ? '+' : ''}{percentChange.toFixed(1)}%)
                </span>
              </div>
            ) : (
              <span style={{ color: C.accent, fontFamily: 'var(--mono)', fontSize: 17, fontWeight: 800 }}>
                {(currentEventFraction * 100).toFixed(4)}%
              </span>
            )}
            <button
              onClick={() => setModifiedValues({})}
              disabled={!hasModifications}
              style={{
                padding: '6px 10px',
                background: hasModifications ? C.field : 'transparent',
                color: hasModifications ? C.textDim : C.textFaint,
                border: `1px solid ${hasModifications ? C.line : 'transparent'}`,
                borderRadius: 8,
                cursor: hasModifications ? 'pointer' : 'default',
                fontSize: 11,
                fontWeight: 700,
                opacity: hasModifications ? 1 : 0.4,
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {activeSweep && (
        <div style={{
          marginBottom: 16,
          padding: 14,
          background: `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
          border: `1px solid ${C.line}`,
          borderRadius: 8,
        }}>
          {sectionTitle('Parameter sweep', (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: C.accent, fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700, overflowWrap: 'anywhere' }}>
                {activeSweep === GLOBAL_SCALE ? 'Global scale ×k (all noise)' : activeSweep}
              </span>
              <button
                onClick={() => setSweepParam(null)}
                title="Close sweep"
                style={{
                  width: 24,
                  height: 24,
                  padding: 0,
                  background: C.field,
                  color: C.textDim,
                  border: `1px solid ${C.line}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <SweepChart
            params={currentParams}
            sweptName={activeSweep}
            evaluate={evaluateFraction}
            onSetValue={handleSweepSet}
          />
        </div>
      )}

      {formulaData.parameters.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {sectionTitle('Parameters', (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setSweepParam(s => (s === GLOBAL_SCALE ? null : GLOBAL_SCALE))}
                title="Sweep all noise rates together: plot the event fraction vs a global multiplier k"
                style={{
                  padding: '4px 10px',
                  background: activeSweep === GLOBAL_SCALE ? C.accent : C.field,
                  color: activeSweep === GLOBAL_SCALE ? C.bg : C.accent,
                  border: `1px solid ${C.accent}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                Sweep ×k
              </button>
              <ExportMenu
                baseName={`circuitscope-parameters-${isAverageSelected ? 'average' : selectedDetector}`}
                getTable={getParameterTable}
                title="Export the parameter table (values, sensitivities, contributions) as CSV or JSON"
              />
              <span style={{ color: C.textDim, fontSize: 11, fontFamily: 'var(--mono)' }}>{formulaData.parameters.length}</span>
            </div>
          ))}
          <div className="soft-scroll" style={{ background: C.field, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 34 }} aria-label="Sweep" />
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Gate</th>
                  <th
                    onClick={() => handleSort('value')}
                    style={{ ...thStyle, textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                  >
                    Value{sortMarker('value')}
                  </th>
                  <th
                    onClick={() => handleSort('count')}
                    style={{ ...thStyle, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                  >
                    Count{sortMarker('count')}
                  </th>
                  <th
                    onClick={() => handleSort('sensitivity')}
                    style={{ ...thStyle, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    title="Partial derivative of event fraction with respect to this parameter"
                  >
                    Sensitivity{sortMarker('sensitivity')}
                  </th>
                  <th
                    onClick={() => handleSort('contribution')}
                    style={{ ...thStyle, textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    title="Log-weight contribution to event fraction"
                  >
                    Contribution{sortMarker('contribution')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedParams.map((p) => (
                  <tr key={p.name} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '6px 4px 6px 10px' }}>
                      <button
                        onClick={() => setSweepParam(s => (s === p.name ? null : p.name))}
                        title="Sweep this parameter: plot the event fraction as it varies over a log range"
                        style={{
                          width: 24,
                          height: 24,
                          padding: 0,
                          background: activeSweep === p.name ? C.accent : C.field,
                          color: activeSweep === p.name ? C.bg : C.textDim,
                          border: `1px solid ${activeSweep === p.name ? C.accent : C.line}`,
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 13,
                          lineHeight: 1,
                        }}
                      >
                        ∿
                      </button>
                    </td>
                    <td style={{ padding: '9px 11px', fontFamily: 'var(--mono)', color: C.accent }}>{p.name}</td>
                    <td style={{ padding: '9px 11px', color: C.error, fontFamily: 'var(--mono)' }}>{p.gate_type}</td>
                    <td style={{ padding: '9px 11px' }}>
                      <ParameterInput
                        value={p.value}
                        originalValue={p.original_value}
                        onChange={(newVal) => setModifiedValues(prev => ({ ...prev, [p.name]: newVal }))}
                        gateType={p.gate_type}
                      />
                    </td>
                    <td style={{ padding: '9px 11px', textAlign: 'right', color: C.text, fontFamily: 'var(--mono)' }}>{p.gate_count ?? p.count}x</td>
                    <td style={{ padding: '9px 11px', textAlign: 'right', fontFamily: 'var(--mono)', color: C.text }}>
                      {(sensitivityMap[p.name] ?? 0).toExponential(2)}
                    </td>
                    <td style={{ padding: '9px 11px', textAlign: 'right', fontFamily: 'var(--mono)', color: C.text }}>
                      {((contributionMap[p.name] ?? 0) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        {sectionTitle('Analytical expression (Python)', (
          <button
            onClick={handleCopy}
            style={{
              padding: '6px 10px',
              background: copyStatus === 'copied' ? C.success : C.field,
              color: copyStatus === 'copied' ? C.bg : C.text,
              border: `1px solid ${copyStatus === 'copied' ? C.success : C.line}`,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {copyStatus === 'copied' ? 'Copied' : 'Copy'}
          </button>
        ))}
        <pre className="soft-scroll" style={{
          background: C.field,
          border: `1px solid ${C.line}`,
          padding: 16,
          borderRadius: 8,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.55,
          fontFamily: 'var(--mono)',
          color: C.text,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {formulaData.python_code}
        </pre>
      </div>
    </div>
  );
}
