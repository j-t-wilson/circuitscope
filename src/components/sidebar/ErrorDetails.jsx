import { useState, useMemo, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { formatZ } from '../../utils/measuredData.js';
import ExportMenu from '../ExportMenu.jsx';

export default function ErrorDetails({ detector, errors, detailedBudget, liveFraction, modelModified, setHoveredMechanism, comparisonStats, mcStats }) {
  const { C } = useTheme();
  const [expandedGroups, setExpandedGroups] = useState({});

  // Don't leave a stale mechanism filter behind when this panel goes away
  useEffect(() => () => setHoveredMechanism?.(null), [setHoveredMechanism]);

  const budgetEntries = useMemo(() => {
    if (detailedBudget?.breakdown) {
      return Object.entries(detailedBudget.breakdown)
        .map(([key, item]) => ({
          key,
          ...item,
          gateName: key.split(':')[0] || key,
          pauli: key.split(':')[1] || '',
        }))
        .sort((a, b) => b.share_of_log_weight - a.share_of_log_weight);
    }

    const grouped = {};
    errors.forEach(e => e.locations.forEach(l => {
      const key = `${l.name}-${l.rate}`;
      if (!grouped[key]) grouped[key] = { key, gateName: l.name, count: 0, rate: l.rate, locations: [], share_of_log_weight: 0 };
      grouped[key].count++;
      grouped[key].locations.push(l);
    }));
    const entries = Object.values(grouped);
    const totalCount = entries.reduce((s, e) => s + e.count, 0);
    entries.forEach(e => { e.share_of_log_weight = totalCount ? e.count / totalCount : 0; });
    return entries;
  }, [errors, detailedBudget]);

  const groupedBudgetEntries = useMemo(() => {
    const groups = {};
    const standalone = [];
    const combinedProb = (subEntries) => {
      let prod = 1;
      subEntries.forEach(e => {
        const p = Math.max(0, Math.min(0.5, e.p_if_only_this_group || 0));
        prod *= (1 - 2 * p);
      });
      return 0.5 * (1 - prod);
    };

    budgetEntries.forEach(entry => {
      // Group depolarizing channels (e.g. "DEPOLARIZE2 q0,q1:X0*X1") by channel,
      // collapsing their individual Pauli components into expandable sub-entries
      const depolMatch = entry.key?.match(/^(DEPOLARIZE1|DEPOLARIZE2(?:\s+q\d+,q\d+)?):(.+)$/);

      if (depolMatch) {
        const [, groupKey, pauliPart] = depolMatch;

        if (!groups[groupKey]) {
          groups[groupKey] = {
            key: groupKey,
            gateName: groupKey.split(' ')[0],
            isGroup: true,
            subEntries: [],
            share_of_log_weight: 0,
            count: 0,
            sum_p: 0,
            example_locations: [],
          };
        }
        const group = groups[groupKey];
        group.subEntries.push({ ...entry, pauli: pauliPart });
        group.share_of_log_weight += entry.share_of_log_weight || 0;
        group.count += entry.count || 0;
        group.sum_p += entry.sum_p || 0;
        if (entry.example_locations) {
          entry.example_locations.forEach(loc => {
            if (!group.example_locations.includes(loc) && group.example_locations.length < 4) {
              group.example_locations.push(loc);
            }
          });
        }
      } else {
        standalone.push(entry);
      }
    });

    Object.values(groups).forEach(group => {
      group.subEntries.sort((a, b) => b.share_of_log_weight - a.share_of_log_weight);
      group.p_if_only_this_group = combinedProb(group.subEntries);
    });

    const result = [...Object.values(groups), ...standalone];
    result.sort((a, b) => b.share_of_log_weight - a.share_of_log_weight);
    return result;
  }, [budgetEntries]);

  const toggleGroup = (key) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // The flat per-(gate, Pauli) entries are the real table behind the grouped
  // display, so export those rather than the depolarizing-group rollups.
  const getBudgetTable = () => ({
    columns: [
      { key: 'mechanism', label: 'mechanism' },
      { key: 'gate', label: 'gate' },
      { key: 'pauli', label: 'pauli' },
      { key: 'count', label: 'count' },
      { key: 'share_of_log_weight', label: 'share_of_log_weight' },
      { key: 'p_if_alone', label: 'p_if_alone' },
      { key: 'sum_p', label: 'sum_p' },
    ],
    rows: budgetEntries.map(e => ({
      mechanism: e.key,
      gate: e.gateName,
      pauli: e.pauli || null,
      count: e.count,
      share_of_log_weight: e.share_of_log_weight,
      p_if_alone: e.p_if_only_this_group,
      sum_p: e.sum_p,
    })),
  });

  const eventFraction = detailedBudget?.event_fraction;
  const eventPercent = eventFraction != null ? (eventFraction * 100).toFixed(3) : null;
  // With parameter overrides active, the headline shows the live fraction
  // (matching the detector cards) with the nominal value struck through —
  // same pattern as the Analysis view.
  const livePercent = modelModified && liveFraction != null ? (liveFraction * 100).toFixed(3) : null;
  const showLive = livePercent != null && livePercent !== eventPercent;

  const colorMap = useMemo(() => {
    const depolColors = [C.gate, C.accent, C.observable];
    const otherColors = [C.error, C.detector, C.measure, C.success, C.warning];
    let depolIdx = 0;
    let otherIdx = 0;
    const map = {};
    groupedBudgetEntries.forEach(entry => {
      if (entry.gateName?.includes('DEPOLARIZE')) {
        map[entry.key] = depolColors[depolIdx++ % depolColors.length];
      } else {
        map[entry.key] = otherColors[otherIdx++ % otherColors.length];
      }
    });
    return map;
  }, [groupedBudgetEntries, C]);

  const getColor = (key) => colorMap[key] || C.textDim;

  // Derive a {name, qubits} filter for timeline highlighting. Qubits come from
  // the group key ("DEPOLARIZE2 q0,q1") or the Pauli term ("X_ERROR:X11"), so
  // hovering a card only lights up that mechanism's locations, not every
  // instance of the same gate elsewhere in the circuit.
  const mechanismFilter = (entry) => {
    const pairMatch = entry.key?.match(/\sq(\d+),q(\d+)$/);
    if (pairMatch) {
      return { name: entry.gateName, qubits: [Number(pairMatch[1]), Number(pairMatch[2])] };
    }
    if (!entry.isGroup) {
      const pauliPart = entry.key?.split(':')[1];
      const qubits = pauliPart ? [...pauliPart.matchAll(/[XYZ](\d+)/g)].map(m => Number(m[1])) : [];
      if (qubits.length) return { name: entry.gateName, qubits };
    }
    return { name: entry.gateName, qubits: null };
  };

  const mechanismCard = (entry, children) => {
    const color = getColor(entry.key);
    const sharePercent = ((entry.share_of_log_weight || 0) * 100).toFixed(1);
    const pOnlyPercent = entry.p_if_only_this_group != null ? (entry.p_if_only_this_group * 100).toFixed(3) : null;

    return (
      <div
        key={entry.key}
        onMouseEnter={() => setHoveredMechanism?.(mechanismFilter(entry))}
        onMouseLeave={() => setHoveredMechanism?.(null)}
        style={{
          padding: 12,
          background: `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
          borderRadius: 8,
          border: `1px solid ${C.line}`,
          borderLeft: `3px solid ${color}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <span style={{ color, fontWeight: 750, fontSize: 13, overflowWrap: 'anywhere' }}>
            {entry.key}
          </span>
          <span style={{ fontSize: 14, fontWeight: 750, color, fontFamily: 'var(--mono)', flexShrink: 0 }}>
            {sharePercent}%
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.textDim, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div>Count <span style={{ color: C.text, fontFamily: 'var(--mono)' }}>{entry.count}</span></div>
          {pOnlyPercent != null && (
            <div>If alone <span style={{ color: C.text, fontFamily: 'var(--mono)' }}>{pOnlyPercent}%</span></div>
          )}
        </div>
        {children}
      </div>
    );
  };

  return (
    <section
      className="glass-panel soft-scroll"
      style={{
        borderRadius: 10,
        padding: 14,
        borderColor: C.lineWarm,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: C.detectorBright, fontWeight: 800, fontFamily: 'var(--mono)' }}>{detector}</h2>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: C.textDim }}>
            {showLive ? 'Event fraction under modified parameters' : 'Event fraction from analytical budget'}
          </p>
        </div>
        {showLive ? (
          <span style={{ whiteSpace: 'nowrap' }}>
            <span style={{ color: C.textDim, fontFamily: 'var(--mono)', fontSize: 13, textDecoration: 'line-through' }}>
              {eventPercent}%
            </span>
            <span style={{ marginLeft: 7, fontSize: 21, fontWeight: 800, color: C.warning, fontFamily: 'var(--mono)' }}>
              {livePercent}%
            </span>
          </span>
        ) : eventPercent != null && (
          <span style={{ fontSize: 21, fontWeight: 800, color: C.error, fontFamily: 'var(--mono)' }}>
            {eventPercent}%
          </span>
        )}
      </div>

      {comparisonStats && (
        <div style={{
          marginTop: 10,
          padding: '9px 11px',
          background: C.field,
          border: `1px solid ${C.line}`,
          borderRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 12,
          fontFamily: 'var(--mono)',
        }}>
          <span style={{ color: C.textDim }}>
            Measured <span style={{ color: C.measure, fontWeight: 800 }}>{(comparisonStats.measured * 100).toFixed(3)}%</span>
          </span>
          <span style={{ color: C.textDim }}>
            Δ <span style={{ color: comparisonStats.delta >= 0 ? C.error : C.accent, fontWeight: 800 }}>
              {comparisonStats.delta >= 0 ? '+' : ''}{(comparisonStats.delta * 100).toFixed(3)}%
            </span>
            {comparisonStats.z != null && (
              <span style={{ marginLeft: 6, color: C.text }}>{formatZ(comparisonStats.z)}</span>
            )}
          </span>
        </div>
      )}

      {mcStats && (
        <div style={{
          marginTop: 10,
          padding: '9px 11px',
          background: C.field,
          border: `1px solid ${C.line}`,
          borderRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 12,
          fontFamily: 'var(--mono)',
        }}>
          <span style={{ color: C.textDim }}>
            {/* 4σ: same agreement bound as the Monte Carlo validation tests */}
            Sampled <span style={{ color: Math.abs(mcStats.z) <= 4 ? C.success : C.error, fontWeight: 800 }}>{(mcStats.measured * 100).toFixed(3)}%</span>
            {' '}±{(mcStats.sigma * 100).toFixed(3)}
          </span>
          <span style={{ color: C.text }}>{formatZ(mcStats.z)}</span>
        </div>
      )}

      <div style={{ margin: '16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textDim, fontSize: 11, marginBottom: 8 }}>
          {/* Budget shares come from the backend analysis, so they always
              describe the nominal rates, not the slider overrides */}
          <span>Contribution breakdown{modelModified ? ' (nominal rates)' : ''}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{groupedBudgetEntries.length} mechanism{groupedBudgetEntries.length !== 1 ? 's' : ''}</span>
            <ExportMenu
              baseName={`circuitscope-budget-${detector}`}
              getTable={getBudgetTable}
              title={`Export ${detector}'s error budget breakdown as CSV or JSON (nominal rates)`}
            />
          </span>
        </div>
        <div style={{
          height: 30,
          background: C.field,
          border: `1px solid ${C.line}`,
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex'
        }}>
          {groupedBudgetEntries.map((entry, i) => {
            const w = (entry.share_of_log_weight || 0) * 100;
            const color = getColor(entry.key);
            return (
              <div
                key={entry.key}
                style={{
                  width: `${w}%`,
                  minWidth: w > 0 ? 2 : 0,
                  height: '100%',
                  background: color,
                  opacity: 0.9,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: C.bg,
                  fontWeight: 800,
                  borderRight: i < groupedBudgetEntries.length - 1 ? `1px solid ${C.bg}` : 'none',
                  transition: 'width 160ms ease',
                }}
                title={`${entry.key}: ${Math.round(w)}%`}
              >
                {w > 12 ? `${Math.round(w)}%` : ''}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groupedBudgetEntries.map((entry) => {
          if (entry.isGroup) {
            const isExpanded = expandedGroups[entry.key];
            const color = getColor(entry.key);
            return (
              <div key={entry.key}>
                <button
                  onClick={() => toggleGroup(entry.key)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  {mechanismCard(entry, (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.textDim, fontSize: 11, marginTop: 8 }}>
                      <span style={{ color, fontFamily: 'var(--mono)', fontWeight: 800 }}>{isExpanded ? '-' : '+'}</span>
                      <span>{entry.subEntries.length} Pauli component{entry.subEntries.length !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </button>
                {isExpanded && (
                  <div style={{ marginLeft: 12, marginTop: 5, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {entry.subEntries.map((subEntry) => {
                      const subSharePercent = ((subEntry.share_of_log_weight || 0) * 100).toFixed(1);
                      const subPOnlyPercent = subEntry.p_if_only_this_group != null ? (subEntry.p_if_only_this_group * 100).toFixed(3) : null;
                      return (
                        <div
                          key={subEntry.key}
                          style={{
                            padding: '8px 10px',
                            background: C.field,
                            borderRadius: 7,
                            border: `1px solid ${C.line}`,
                            borderLeft: `2px solid ${color}`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ color: C.text, fontWeight: 650, fontSize: 11 }}>{subEntry.pauli || subEntry.key}</span>
                            <span style={{ fontSize: 11, fontWeight: 750, color, fontFamily: 'var(--mono)' }}>
                              {subSharePercent}%
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: C.textDim, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            <span>Count {subEntry.count}</span>
                            {subPOnlyPercent != null && <span>If alone {subPOnlyPercent}%</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return mechanismCard(entry);
        })}
      </div>
    </section>
  );
}
