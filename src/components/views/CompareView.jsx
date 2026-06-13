import { useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useCircuit } from '../../contexts/CircuitContext.jsx';
import { runFit } from '../../utils/parameterFit.js';

// Above this χ²/dof the model (or scenario) is treated as a poor fit.
const GOOD_FIT = 1.5;

const fmtRate = (v) => (v === 0 ? '0' : v.toPrecision(3));
const fmtMult = (m) => (m == null ? null : `×${m >= 100 ? m.toFixed(0) : m.toFixed(2)}`);

// The Compare view is the global measured-vs-model surface: residuals across
// all detectors at once, and the least-squares answer to "which knob explains
// the data". Scenario Try / Apply buttons write the shared parameter overrides,
// so the Analysis sliders and the detector panel follow along.
export default function CompareView() {
  const { C } = useTheme();
  const {
    data,
    measuredData,
    formulaModel,
    comparison,
    hasModifiedParams,
    setModifiedValues,
    selectedDetector,
    setSelectedDetector,
    setShowImportModal,
  } = useCircuit();

  const shots = measuredData?.shots || null;

  // The full fit: nominal goodness of fit, ranked scenarios, dense fit.
  // Closed-form, so it simply recomputes when the dataset or circuit changes.
  const fit = useMemo(
    () => (formulaModel && measuredData ? runFit(formulaModel, measuredData) : null),
    [formulaModel, measuredData]
  );

  // Goodness of fit of the *current* model (with any parameter overrides),
  // from the same per-detector stats the rest of the app displays.
  const current = useMemo(() => {
    if (!comparison) return null;
    const stats = Object.values(comparison);
    if (!stats.length) return null;
    let chi2 = 0;
    let ssr = 0;
    let haveZ = true;
    for (const s of stats) {
      ssr += s.delta * s.delta;
      if (s.z == null) haveZ = false;
      else chi2 += s.z * s.z;
    }
    const n = stats.length;
    return {
      n,
      rms: Math.sqrt(ssr / n),
      perDof: haveZ ? chi2 / n : null,
    };
  }, [comparison]);

  // Residual chart rows in detector order.
  const chartRows = useMemo(() => {
    if (!comparison || !data) return [];
    return data.detectors
      .filter(d => comparison[d.name])
      .map(d => ({ name: d.name, ...comparison[d.name] }));
  }, [comparison, data]);

  const fmtGof = (g) => (g.perDof != null ? `χ²/dof ${g.perDof.toFixed(2)}` : `RMS Δ ${(g.rms * 100).toFixed(3)}%`);
  const fmtGofShort = (g) => (g.perDof != null ? g.perDof.toFixed(2) : `${(g.rms * 100).toFixed(3)}%`);
  const gofValue = (g) => (g.perDof != null ? g.perDof : g.rms);
  const gofColor = (g) => {
    if (g.perDof == null) return C.text;
    return g.perDof <= GOOD_FIT ? C.success : g.perDof <= 4 ? C.warning : C.error;
  };

  const card = (children, key, borderColor = C.line) => (
    <div
      key={key}
      style={{
        marginBottom: 16,
        padding: 14,
        background: `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );

  const sectionTitle = (label, extra = null) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 9 }}>
      <h3 className="display-title" style={{ margin: 0, fontSize: 17, color: C.text }}>{label}</h3>
      {extra}
    </div>
  );

  const actionButton = (label, onClick, { tone = 'accent', title } = {}) => {
    const color = tone === 'warning' ? C.warning : C.accent;
    return (
      <button
        onClick={onClick}
        title={title}
        style={{
          padding: '4px 10px',
          background: C.field,
          color,
          border: `1px solid ${color}`,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {label}
      </button>
    );
  };

  if (!measuredData) {
    return card(
      <div style={{ padding: 20, textAlign: 'center', color: C.textDim }}>
        <p style={{ margin: '0 0 8px', color: C.text }}>
          No measured data loaded.
        </p>
        <p style={{ fontSize: 12, margin: '0 0 14px' }}>
          Import per-detector measured event fractions (CSV or JSON, plus a shot count) to see
          residuals across all detectors and fit the noise parameters to your data.
        </p>
        <button
          onClick={() => setShowImportModal(true)}
          style={{
            padding: '8px 16px',
            background: `linear-gradient(180deg, ${C.accent}, color-mix(in srgb, ${C.accent} 72%, ${C.bg}))`,
            color: C.bg,
            border: `1px solid ${C.accent}`,
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 750,
          }}
        >
          Import data
        </button>
      </div>,
      'empty'
    );
  }

  if (!formulaModel) {
    return card(
      <div style={{ padding: 20, textAlign: 'center', color: C.textDim }}>
        Building the global parameter model for this circuit…
      </div>,
      'loading'
    );
  }

  if (!fit) {
    return card(
      <div style={{ padding: 20, textAlign: 'center', color: C.textDim }}>
        The measured data does not cover any detectors of this circuit, or the circuit has no
        noise parameters to fit.
      </div>,
      'nofit'
    );
  }

  // Try a scenario: replace the override set with exactly this scenario
  // (scenarios are defined relative to nominal, not to previous overrides).
  const applyScenario = (changes) => {
    setModifiedValues(Object.fromEntries(changes.map(c => [c.name, c.to])));
  };

  const modelConsistent = fit.nominal.perDof != null && fit.nominal.perDof <= GOOD_FIT;
  const denseStillPoor = fit.dense && fit.dense.fit.perDof != null && fit.dense.fit.perDof > 4;
  // Only surface pair scenarios when they meaningfully beat the best single.
  const showPairs = fit.pairs.length > 0 && fit.singles.length > 0 &&
    gofValue(fit.pairs[0].fit) < 0.8 * gofValue(fit.singles[0].fit);

  // ---- Residual chart geometry ----
  const useZ = chartRows.length > 0 && chartRows.every(r => r.z != null);
  const values = chartRows.map(r => (useZ ? r.z : r.delta * 100));
  const maxAbs = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const yMax = useZ ? Math.max(3, maxAbs * 1.12) : Math.max(maxAbs * 1.12, 1e-6);
  const chartH = 170;
  const axisW = 44;
  const labelH = 16;
  const barSlot = Math.max(4, Math.min(22, Math.floor(820 / Math.max(1, chartRows.length))));
  const chartW = axisW + chartRows.length * barSlot + 8;
  const yOf = (v) => (chartH / 2) * (1 - v / yMax);
  const labelEvery = Math.max(1, Math.ceil(chartRows.length / 14));
  // Hide the ±2σ gridlines when huge residuals compress them onto the zero line
  const showSigmaTicks = useZ && yOf(0) - yOf(2) > 10;

  const scenarioRow = (scenario, key) => {
    const after = scenario.fit;
    return (
      <div
        key={key}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: '7px 10px',
          background: C.field,
          border: `1px solid ${C.line}`,
          borderRadius: 7,
          fontSize: 12,
          fontFamily: 'var(--mono)',
        }}
      >
        <span style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          {scenario.changes.map(c => (
            <span key={c.name} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <span style={{ color: C.accent, fontWeight: 700, overflowWrap: 'anywhere' }}>{c.name}</span>
              <span style={{ color: C.textDim }}>
                {fmtRate(c.from)} <span style={{ color: C.textFaint }}>→</span>{' '}
                <span style={{ color: C.warning, fontWeight: 800 }}>{fmtRate(c.to)}</span>
              </span>
              {c.mult != null && (
                <span style={{ color: c.mult >= 1 ? C.error : C.success, fontWeight: 800 }}>{fmtMult(c.mult)}</span>
              )}
              {c.clamped && <span style={{ color: C.textFaint, fontSize: 10 }}>(at zero)</span>}
            </span>
          ))}
        </span>
        <span style={{ color: C.textDim, whiteSpace: 'nowrap' }}>
          {fmtGof(fit.nominal)} <span style={{ color: C.textFaint }}>→</span>{' '}
          <span style={{ color: gofColor(after), fontWeight: 800 }}>{fmtGofShort(after)}</span>
        </span>
        {actionButton('Try', () => applyScenario(scenario.changes), {
          title: 'Apply this scenario to the shared parameter values (replaces other tweaks)',
        })}
      </div>
    );
  };

  return (
    <div>
      {/* ---- Overview ---- */}
      {card(
        <>
          {sectionTitle('Measured vs model', (
            <span style={{ color: C.textDim, fontSize: 11, fontFamily: 'var(--mono)' }}>
              {fit.numRows} of {data.detectors.length} detectors ·{' '}
              {fit.uniquePatterns} unique response pattern{fit.uniquePatterns === 1 ? '' : 's'} ·{' '}
              {shots ? `${Number(shots).toLocaleString()} shots` : 'no shot count'}
            </span>
          ))}

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontFamily: 'var(--mono)', fontSize: 13, marginBottom: 10 }}>
            <span style={{ color: C.textDim }}>
              Nominal model{' '}
              <span style={{ color: gofColor(fit.nominal), fontWeight: 800 }}>{fmtGof(fit.nominal)}</span>
            </span>
            {hasModifiedParams && current && (
              <span style={{ color: C.textDim }}>
                Current (modified){' '}
                <span style={{ color: C.warning, fontWeight: 800 }}>{fmtGof(current)}</span>
              </span>
            )}
          </div>

          {chartRows.length > 0 && (
            <div className="soft-scroll" style={{ overflowX: 'auto', paddingBottom: 4 }}>
              <svg
                width={chartW}
                height={chartH + labelH}
                style={{ display: 'block' }}
                role="img"
                aria-label="Residuals per detector"
              >
                {/* ±2σ band */}
                {showSigmaTicks && (
                  <rect
                    x={axisW}
                    y={yOf(2)}
                    width={chartW - axisW}
                    height={yOf(-2) - yOf(2)}
                    fill={C.success}
                    opacity={0.08}
                  />
                )}
                {/* zero line */}
                <line x1={axisW} y1={yOf(0)} x2={chartW} y2={yOf(0)} stroke={C.lineStrong} strokeWidth={1} />
                {/* axis labels */}
                {(showSigmaTicks ? [2, -2] : []).map(v => (
                  <g key={v}>
                    <line x1={axisW} y1={yOf(v)} x2={chartW} y2={yOf(v)} stroke={C.line} strokeDasharray="3 4" />
                    <text x={axisW - 5} y={yOf(v) + 3} textAnchor="end" fontSize={9} fill={C.textFaint} fontFamily="var(--mono)">
                      {v > 0 ? `+${v}σ` : `${v}σ`}
                    </text>
                  </g>
                ))}
                <text x={axisW - 5} y={yOf(0) + 3} textAnchor="end" fontSize={9} fill={C.textFaint} fontFamily="var(--mono)">
                  {useZ ? '0σ' : '0'}
                </text>
                {!useZ && (
                  <text x={axisW - 5} y={12} textAnchor="end" fontSize={9} fill={C.textFaint} fontFamily="var(--mono)">
                    Δ%
                  </text>
                )}
                {/* bars */}
                {chartRows.map((row, i) => {
                  const v = values[i];
                  const x = axisW + i * barSlot + 1;
                  const sel = selectedDetector === row.name;
                  const y0 = yOf(Math.max(0, v));
                  const h = Math.max(1, Math.abs(yOf(v) - yOf(0)));
                  return (
                    <g key={row.name} style={{ cursor: 'pointer' }} onClick={() => setSelectedDetector(sel ? null : row.name)}>
                      {/* full-height hit area so thin bars stay clickable */}
                      <rect x={x - 1} y={0} width={barSlot} height={chartH} fill="transparent" />
                      <rect
                        x={x}
                        y={y0}
                        width={Math.max(2, barSlot - 2)}
                        height={h}
                        fill={v >= 0 ? C.error : C.accent}
                        opacity={sel ? 1 : 0.75}
                        stroke={sel ? C.detectorBright : 'none'}
                        strokeWidth={sel ? 1.5 : 0}
                      />
                      {i % labelEvery === 0 && (
                        <text
                          x={x + barSlot / 2}
                          y={chartH + 12}
                          textAnchor="middle"
                          fontSize={9}
                          fill={sel ? C.detectorBright : C.textFaint}
                          fontFamily="var(--mono)"
                        >
                          {row.name}
                        </text>
                      )}
                      <title>
                        {`${row.name} — measured ${(row.measured * 100).toFixed(3)}%, model ${(row.model * 100).toFixed(3)}%, `}
                        {useZ ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}σ` : `Δ ${v >= 0 ? '+' : ''}${v.toFixed(3)}%`}
                      </title>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          <div style={{ marginTop: 6, color: C.textFaint, fontSize: 10, fontFamily: 'var(--mono)' }}>
            residual per detector ({useZ ? 'in σ of the current model' : 'measured − model, %'}) — click a bar to select the detector
          </div>
        </>,
        'overview'
      )}

      {/* ---- Verdict / scenarios ---- */}
      {modelConsistent ? (
        card(
          <p style={{ margin: 0, fontSize: 12, color: C.success }}>
            The nominal model is consistent with the measured fractions at this shot count
            ({fmtGof(fit.nominal)}) — nothing to fit.
          </p>,
          'consistent',
          C.success
        )
      ) : (
        <>
          {card(
            <>
              {sectionTitle('Most likely scenarios', (
                <span style={{ color: C.textDim, fontSize: 11 }}>
                  single-knob changes that best explain the data
                </span>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {fit.singles.map((s, i) => scenarioRow(s, `s${i}`))}
              </div>
              {showPairs && (
                <>
                  <p style={{ margin: '12px 0 6px', fontSize: 12, color: C.textDim }}>
                    Two-knob scenarios (best single knob plus one more):
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {fit.pairs.slice(0, 3).map((s, i) => scenarioRow(s, `p${i}`))}
                  </div>
                </>
              )}
              {denseStillPoor && (
                <p style={{ margin: '12px 0 0', fontSize: 12, color: C.error }}>
                  Even the unrestricted fit of all parameters stays poor
                  ({fmtGof(fit.dense.fit)}). No rate adjustment explains this data — the model is
                  likely missing an error mechanism (or the data disagrees with the circuit).
                </p>
              )}
            </>,
            'scenarios'
          )}

          {/* ---- Dense fit ---- */}
          {fit.dense && card(
            <>
              {sectionTitle('Full least-squares fit', (
                <span style={{ color: gofColor(fit.dense.fit), fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 800 }}>
                  {fmtGof(fit.dense.fit)}
                </span>
              ))}
              <div className="soft-scroll" style={{ background: C.field, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'auto' }}>
                <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Parameter', 'Nominal', 'Fitted', 'Change'].map((h, i) => (
                        <th
                          key={h}
                          style={{
                            padding: '8px 11px',
                            textAlign: i === 0 ? 'left' : 'right',
                            color: C.textDim,
                            fontWeight: 700,
                            borderBottom: `1px solid ${C.line}`,
                            background: C.fieldAlt,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fit.dense.changes.map(c => {
                      const sigma = fit.dense.sigmas[c.name];
                      const moved = c.from > 0 ? Math.abs(Math.log(Math.max(c.to, 1e-300) / c.from)) > 0.02 : c.to > 0;
                      return (
                        <tr key={c.name} style={{ borderTop: `1px solid ${C.line}` }}>
                          <td style={{ padding: '8px 11px', fontFamily: 'var(--mono)', color: C.accent }}>{c.name}</td>
                          <td style={{ padding: '8px 11px', textAlign: 'right', fontFamily: 'var(--mono)', color: C.textDim }}>
                            {fmtRate(c.from)}
                          </td>
                          <td style={{ padding: '8px 11px', textAlign: 'right', fontFamily: 'var(--mono)', color: moved ? C.warning : C.text }}>
                            {fmtRate(c.to)}
                            {sigma != null && <span style={{ color: C.textFaint }}> ±{fmtRate(sigma)}</span>}
                            {c.clamped && <span style={{ color: C.textFaint, fontSize: 10 }}> (at zero)</span>}
                          </td>
                          <td style={{ padding: '8px 11px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color: !moved ? C.textFaint : c.mult >= 1 ? C.error : C.success }}>
                            {c.mult != null ? fmtMult(c.mult) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {actionButton('Apply fitted values', () => applyScenario(fit.dense.changes), {
                  title: 'Set all parameters to their fitted values',
                })}
                {hasModifiedParams && actionButton('Reset to nominal', () => setModifiedValues({}), {
                  tone: 'warning',
                  title: 'Clear all parameter overrides',
                })}
              </div>
            </>,
            'dense'
          )}
        </>
      )}

      {/* ---- Caveats ---- */}
      {(fit.noLeverage.length > 0 || fit.degenerateGroups.length > 0 || fit.warnings.length > 0) && card(
        <>
          {sectionTitle('Caveats')}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.textDim, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {fit.degenerateGroups.map((group, i) => (
              <li key={`dg${i}`}>
                <span style={{ fontFamily: 'var(--mono)', color: C.accent }}>{group.join(', ')}</span>{' '}
                affect the measured detectors in exactly proportional ways — only their combination
                is constrained, so their fitted values are anchored toward nominal.
              </li>
            ))}
            {fit.noLeverage.length > 0 && (
              <li>
                Not constrained by the measured detectors (kept at nominal):{' '}
                <span style={{ fontFamily: 'var(--mono)', color: C.accent }}>{fit.noLeverage.join(', ')}</span>
              </li>
            )}
            {fit.warnings.map((w, i) => <li key={`w${i}`}>{w}</li>)}
          </ul>
        </>,
        'caveats'
      )}
    </div>
  );
}
