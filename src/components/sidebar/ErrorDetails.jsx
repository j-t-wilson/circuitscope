import { useState, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';

export default function ErrorDetails({ detector, errors, detailedBudget }) {
  const { C } = useTheme();
  const [expandedGroups, setExpandedGroups] = useState({});

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
      const depol2Match = entry.key?.match(/^(DEPOLARIZE2(?:\s+q\d+,q\d+)?):(.+)$/);
      const depol1Match = entry.key?.match(/^(DEPOLARIZE1):(.+)$/);

      if (depol2Match || depol1Match) {
        const match = depol2Match || depol1Match;
        const groupKey = match[1];
        const pauliPart = match[2];

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

  const eventFraction = detailedBudget?.event_fraction;
  const eventPercent = eventFraction != null ? (eventFraction * 100).toFixed(3) : null;

  const depolColors = [C.gate, C.accent, C.observable];
  const otherColors = [C.error, C.detector, C.measure, C.success, C.warning];

  const colorState = useMemo(() => {
    let depolIdx = 0;
    let otherIdx = 0;
    const colorMap = {};
    groupedBudgetEntries.forEach(entry => {
      if (entry.gateName?.includes('DEPOLARIZE')) {
        colorMap[entry.key] = depolColors[depolIdx % depolColors.length];
        depolIdx++;
      } else {
        colorMap[entry.key] = otherColors[otherIdx % otherColors.length];
        otherIdx++;
      }
    });
    return colorMap;
  }, [groupedBudgetEntries, depolColors, otherColors]);

  const getColor = (key) => colorState[key] || C.textDim;

  const mechanismCard = (entry, children) => {
    const color = getColor(entry.key);
    const sharePercent = ((entry.share_of_log_weight || 0) * 100).toFixed(1);
    const pOnlyPercent = entry.p_if_only_this_group != null ? (entry.p_if_only_this_group * 100).toFixed(3) : null;

    return (
      <div
        key={entry.key}
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
            Event fraction from analytical budget
          </p>
        </div>
        {eventPercent != null && (
          <span style={{ fontSize: 21, fontWeight: 800, color: C.error, fontFamily: 'var(--mono)' }}>
            {eventPercent}%
          </span>
        )}
      </div>

      <div style={{ margin: '16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: C.textDim, fontSize: 11, marginBottom: 8 }}>
          <span>Contribution breakdown</span>
          <span>{groupedBudgetEntries.length} mechanism{groupedBudgetEntries.length !== 1 ? 's' : ''}</span>
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
