import { useState, useMemo, useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { heatColor } from '../../utils/heatColor.js';
import { formatZ } from '../../utils/measuredData.js';
import ExportMenu from '../ExportMenu.jsx';

// |z| at and beyond which a residual renders fully "hot"
const Z_HEAT_SCALE = 4;

// |z| within which a sampled fraction counts as agreeing with the analytical
// model (same 4σ bound the test suite's Monte Carlo validation uses)
const MC_AGREE_Z = 4;

const MC_SHOT_CHOICES = [
  { value: 100_000, label: '10⁵ shots' },
  { value: 1_000_000, label: '10⁶ shots' },
  { value: 10_000_000, label: '10⁷ shots' },
];

const SORT_LABELS = { id: 'sort: id', fraction: 'sort: %', delta: 'sort: Δ' };
const SORT_TITLES = {
  id: 'Sorted by id. Click to sort by event fraction.',
  fraction: 'Sorted by event fraction (hottest first). Click to sort by measured-model discrepancy.',
  delta: 'Sorted by measured-model discrepancy (worst fit first). Click to sort by id.',
};

export default function DetectorPanel({ detectors, nominalDetectors, modelModified, selectedDetector, setSelectedDetector, setHoveredDetector, comparison, monteCarlo, fractionDeltas }) {
  const { C, isDark } = useTheme();
  const [sortMode, setSortMode] = useState('id');
  const [mcShots, setMcShots] = useState(1_000_000);
  const selectedRef = useRef(null);

  const hasComparison = !!comparison;
  const mcSampling = monteCarlo?.status === 'sampling';

  // Worst sampled-vs-analytical detector, for the verify verdict line
  const mcWorst = useMemo(() => {
    if (!monteCarlo?.comparison) return null;
    let worst = null;
    Object.entries(monteCarlo.comparison).forEach(([name, s]) => {
      if (!worst || Math.abs(s.z) > Math.abs(worst.z)) worst = { name, z: s.z };
    });
    return worst;
  }, [monteCarlo?.comparison]);

  // Detectors whose fraction the last live edit changed (or that it added)
  const editFlagged = useMemo(() => {
    if (!fractionDeltas) return null;
    const flagged = new Set(fractionDeltas.changed.map(c => c.name));
    fractionDeltas.added.forEach(name => flagged.add(name));
    return flagged.size ? flagged : null;
  }, [fractionDeltas]);

  // Without measured data the sort toggle is the original two-state button
  const sortModes = hasComparison ? ['id', 'fraction', 'delta'] : ['id', 'fraction'];
  const effectiveSort = sortModes.includes(sortMode) ? sortMode : 'id';
  const cycleSort = () => {
    const idx = sortModes.indexOf(effectiveSort);
    setSortMode(sortModes[(idx + 1) % sortModes.length]);
  };

  // With measured data loaded, average the model over the measured-covered
  // detectors only, so "Avg model · meas" compares like with like even when
  // the dataset doesn't cover every detector.
  const avgDetectors = hasComparison ? detectors.filter(d => comparison[d.name]) : detectors;
  const avgEventFraction = avgDetectors.length > 0
    ? avgDetectors.reduce((sum, d) => sum + (d.event_fraction || 0), 0) / avgDetectors.length
    : 0;
  const avgPercent = (avgEventFraction * 100).toFixed(2);

  const measuredAvg = useMemo(() => {
    if (!comparison) return null;
    const stats = Object.values(comparison);
    if (!stats.length) return null;
    return stats.reduce((sum, s) => sum + s.measured, 0) / stats.length;
  }, [comparison]);

  // Normalizer for residual coloring when no shot count (and so no z) exists
  const maxAbsDelta = useMemo(() => {
    if (!comparison) return 0;
    return Object.values(comparison).reduce((max, s) => Math.max(max, Math.abs(s.delta)), 0);
  }, [comparison]);

  const discrepancy = (d) => {
    const stats = comparison?.[d.name];
    if (!stats) return -1; // detectors without data sort last
    return stats.z != null
      ? Math.abs(stats.z)
      : (maxAbsDelta > 0 ? Math.abs(stats.delta) / maxAbsDelta : 0);
  };

  const residualHeat = (stats) => {
    if (!stats) return 0;
    if (stats.z != null) return Math.min(Math.abs(stats.z) / Z_HEAT_SCALE, 1);
    return maxAbsDelta > 0 ? Math.abs(stats.delta) / maxAbsDelta : 0;
  };

  const sortedDetectors = useMemo(() => {
    if (effectiveSort === 'fraction') {
      return [...detectors].sort((a, b) => (b.event_fraction || 0) - (a.event_fraction || 0));
    }
    if (effectiveSort === 'delta') {
      return [...detectors].sort((a, b) => discrepancy(b) - discrepancy(a));
    }
    return detectors;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectors, effectiveSort, comparison, maxAbsDelta]);

  // Keep the selected card visible while stepping with arrow keys
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedDetector]);

  // Everything the panel shows, one row per detector: live model fraction
  // (plus the nominal one when overrides are active), measured stats, and the
  // Monte Carlo sample. Optional columns appear only when their data exists.
  const getDetectorTable = () => {
    const nominalByName = {};
    (nominalDetectors || []).forEach(d => { nominalByName[d.name] = d.event_fraction; });
    const columns = [
      { key: 'detector', label: 'detector' },
      { key: 'model_fraction', label: 'model_fraction' },
      ...(modelModified ? [{ key: 'nominal_fraction', label: 'nominal_fraction' }] : []),
      ...(hasComparison ? [
        { key: 'measured_fraction', label: 'measured_fraction' },
        { key: 'measured_sigma', label: 'measured_sigma' },
        { key: 'z', label: 'z' },
      ] : []),
      ...(monteCarlo?.comparison ? [
        { key: 'mc_fraction', label: 'mc_fraction' },
        { key: 'mc_sigma', label: 'mc_sigma' },
        { key: 'mc_z', label: 'mc_z' },
      ] : []),
    ];
    const rows = sortedDetectors.map(d => {
      const stats = comparison?.[d.name];
      const mc = monteCarlo?.comparison?.[d.name];
      return {
        detector: d.name,
        model_fraction: d.event_fraction ?? 0,
        nominal_fraction: modelModified ? nominalByName[d.name] : null,
        measured_fraction: stats?.measured,
        measured_sigma: stats?.sigma,
        z: stats?.z,
        mc_fraction: mc?.measured,
        mc_sigma: mc?.sigma,
        mc_z: mc?.z,
      };
    });
    return { columns, rows };
  };

  return (
    <section
      className="glass-panel"
      style={{
        borderRadius: 10,
        padding: 14,
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 className="display-title" style={{ margin: 0, fontSize: 19, color: C.text }}>Detectors</h2>
          <button
            onClick={cycleSort}
            title={SORT_TITLES[effectiveSort]}
            style={{
              padding: '3px 8px',
              background: effectiveSort !== 'id' ? C.amberSoft : C.field,
              color: effectiveSort !== 'id' ? C.detectorBright : C.textDim,
              border: `1px solid ${effectiveSort !== 'id' ? C.detector : C.line}`,
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--mono)',
              transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
            }}
          >
            {SORT_LABELS[effectiveSort]}
          </button>
          <ExportMenu
            baseName="circuitscope-detectors"
            getTable={getDetectorTable}
            title="Export the detector table (model, measured, Monte Carlo) as CSV or JSON"
          />
        </div>
        <div
          style={{ textAlign: 'right' }}
          title={hasComparison
            ? `Both averages are over the ${avgDetectors.length} detector${avgDetectors.length === 1 ? '' : 's'} with measured data`
            : undefined}
        >
          <div style={{ color: C.textDim, fontSize: 11 }}>
            {hasComparison ? 'Avg model · meas' : 'Average'}
            {modelModified ? ' (modified)' : ''}
          </div>
          <div style={{ fontSize: 16, fontWeight: 750, fontFamily: 'var(--mono)' }}>
            <span style={{ color: modelModified ? C.warning : C.text }}>
              {avgPercent}%
            </span>
            {measuredAvg != null && (
              <span style={{ color: C.measure }}>
                {' · '}{(measuredAvg * 100).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {monteCarlo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <select
            value={mcShots}
            onChange={e => setMcShots(Number(e.target.value))}
            disabled={mcSampling}
            title="Number of shots to sample"
            style={{
              padding: '3px 4px',
              background: C.field,
              color: C.textDim,
              border: `1px solid ${C.line}`,
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--mono)',
              cursor: mcSampling ? 'default' : 'pointer',
            }}
          >
            {MC_SHOT_CHOICES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => monteCarlo.run(mcShots)}
            disabled={mcSampling}
            title="Sample the circuit server-side (Monte Carlo) and compare the sampled detector fractions against the analytical model"
            style={{
              padding: '3px 8px',
              background: monteCarlo.comparison ? C.amberSoft : C.field,
              color: monteCarlo.comparison ? C.detectorBright : C.textDim,
              border: `1px solid ${monteCarlo.comparison ? C.detector : C.line}`,
              borderRadius: 6,
              cursor: mcSampling ? 'wait' : 'pointer',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'var(--mono)',
              opacity: mcSampling ? 0.6 : 1,
              transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
            }}
          >
            {mcSampling ? 'sampling…' : monteCarlo.comparison ? 'MC re-run' : 'MC verify'}
          </button>
          {monteCarlo.comparison && !mcSampling && (
            <button
              onClick={monteCarlo.clear}
              title="Clear the Monte Carlo sample"
              aria-label="Clear the Monte Carlo sample"
              style={{
                padding: '3px 6px',
                background: 'transparent',
                color: C.textFaint,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              ×
            </button>
          )}
          {monteCarlo.status === 'error' && (
            <span style={{ fontSize: 10, color: C.error, fontFamily: 'var(--mono)' }}>
              {monteCarlo.error}
            </span>
          )}
          {mcWorst && !mcSampling && monteCarlo.status !== 'error' && (
            <span
              title={`Largest sampled-vs-analytical deviation: ${mcWorst.name} at ${formatZ(mcWorst.z)} of the expected sampling noise for ${monteCarlo.shots?.toLocaleString()} shots`
                + (modelModified ? '. Sampled fractions are compared against the nominal model, not the modified parameters.' : '')}
              style={{
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'var(--mono)',
                color: Math.abs(mcWorst.z) <= MC_AGREE_Z ? C.success : C.error,
              }}
            >
              {Math.abs(mcWorst.z) <= MC_AGREE_Z
                ? `✓ agrees ≤${MC_AGREE_Z}σ (worst ${mcWorst.name} ${formatZ(mcWorst.z)})`
                : `✗ ${mcWorst.name} off by ${formatZ(mcWorst.z)}`}
              {modelModified ? ' · vs nominal' : ''}
            </span>
          )}
        </div>
      )}

      <div
        className="soft-scroll detector-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          alignContent: 'start',
          gap: 8,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          paddingRight: 2,
        }}
      >
        {sortedDetectors.map(d => {
          const sel = selectedDetector === d.name;
          const fraction = d.event_fraction || 0;
          const eventPercent = (fraction * 100).toFixed(2);
          const stats = comparison?.[d.name];
          const residualC = stats ? heatColor(residualHeat(stats), isDark) : null;
          const mcStats = monteCarlo?.comparison?.[d.name];
          const editChanged = editFlagged?.has(d.name);
          return (
            <button
              key={d.name}
              ref={sel ? selectedRef : null}
              onClick={() => setSelectedDetector(sel ? null : d.name)}
              onMouseEnter={() => setHoveredDetector?.(d.name)}
              onMouseLeave={() => setHoveredDetector?.(null)}
              title={(stats
                ? `${d.name} — model ${(stats.model * 100).toFixed(3)}%, measured ${(stats.measured * 100).toFixed(3)}%${stats.z != null ? ` (${formatZ(stats.z)})` : ''}`
                : `${d.name} — model ${eventPercent}%`)
                + (mcStats ? ` · sampled ${(mcStats.measured * 100).toFixed(3)}% ±${(mcStats.sigma * 100).toFixed(3)} (${formatZ(mcStats.z)})` : '')
                + (editChanged ? ' · changed by last edit' : '')}
              style={{
                position: 'relative',
                minHeight: 54,
                padding: '9px 7px',
                background: sel
                  ? `linear-gradient(180deg, ${C.amberSoft}, ${C.panelWarm})`
                  : `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
                border: `1px solid ${sel ? C.detectorBright : C.line}`,
                borderRadius: 8,
                cursor: 'pointer',
                color: C.text,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                boxShadow: sel ? `0 0 0 1px ${C.amberSoft}, 0 12px 28px ${C.amberSoft}` : 'none',
                transition: 'background 140ms ease, border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease',
              }}
            >
              {editChanged && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 5,
                    right: 6,
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: C.warning,
                  }}
                />
              )}
              <span style={{ fontWeight: 750, fontSize: 14, lineHeight: 1, fontFamily: 'var(--mono)', color: sel ? C.detectorBright : C.text }}>
                {d.name}
              </span>
              <span style={{ fontSize: 12, fontWeight: 650, color: C.textDim, fontFamily: 'var(--mono)' }}>
                {eventPercent}%
              </span>
              {mcStats && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: 'var(--mono)',
                  lineHeight: 1,
                  color: Math.abs(mcStats.z) <= MC_AGREE_Z ? C.success : C.error,
                }}>
                  ≈{(mcStats.measured * 100).toFixed(2)}±{(mcStats.sigma * 100).toFixed(2)}
                </span>
              )}
              {stats && (
                <span style={{ fontSize: 11, fontWeight: 700, color: residualC, fontFamily: 'var(--mono)', lineHeight: 1 }}>
                  {(stats.measured * 100).toFixed(2)}%
                  {stats.z != null && (
                    <span style={{ fontSize: 9, marginLeft: 3 }}>{formatZ(stats.z)}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 10, color: C.textFaint, fontSize: 10, fontFamily: 'var(--mono)', textAlign: 'center' }}>
        {(() => {
          const legend = [
            'model %',
            monteCarlo?.comparison && '≈ sampled ±σ',
            hasComparison && 'measured %',
          ].filter(Boolean);
          const keys = '← → step detectors · esc deselect';
          return legend.length > 1 ? `${legend.join(' · ')} — ${keys}` : keys;
        })()}
      </div>
    </section>
  );
}
