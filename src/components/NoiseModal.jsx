import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useCircuit } from '../contexts/CircuitContext.jsx';

// Independent noise sources the backend can insert (POST /api/noise). Each is
// applied on its own, so the user composes exactly the model they believe in.
const SOURCE_DEFS = [
  {
    type: 'gate2_depolarizing',
    label: '2-qubit gate depolarizing',
    detail: 'DEPOLARIZE2(p) after every two-qubit gate',
    defaultP: '0.005',
  },
  {
    type: 'gate1_depolarizing',
    label: '1-qubit gate depolarizing',
    detail: 'DEPOLARIZE1(p) after every single-qubit gate',
    defaultP: '0.001',
  },
  {
    type: 'reset_flip',
    label: 'Reset flip',
    detail: 'X_ERROR(p) after every reset (Z_ERROR after RX)',
    defaultP: '0.002',
  },
  {
    type: 'measure_flip',
    label: 'Measurement flip',
    detail: 'X_ERROR(p) before every measurement (Z_ERROR before MX)',
    defaultP: '0.01',
  },
  {
    type: 'idle_depolarizing',
    label: 'Idle depolarizing',
    detail: 'DEPOLARIZE1(p) on qubits idle during the selected layers',
    defaultP: '0.001',
    hasDuring: true,
  },
];

const DURING_OPTIONS = [
  { value: 'gate2', label: '2-qubit gate layers' },
  { value: 'measure', label: 'measurement layers' },
  { value: 'all', label: 'all layers' },
];

function parseRate(text) {
  const v = Number(text);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

export default function NoiseModal({ onClose }) {
  const { C } = useTheme();
  const { data, handleLiveEdit } = useCircuit();

  const [enabled, setEnabled] = useState({});
  const [rates, setRates] = useState(() =>
    Object.fromEntries(SOURCE_DEFS.map(d => [d.type, d.defaultP]))
  );
  const [during, setDuring] = useState('gate2');
  const [stripExisting, setStripExisting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);

  const enabledDefs = SOURCE_DEFS.filter(d => enabled[d.type]);
  const invalidRates = enabledDefs.filter(d => parseRate(rates[d.type]) === null);
  const canApply = !applying
    && invalidRates.length === 0
    && (enabledDefs.length > 0 || stripExisting);

  // The circuit text already contains noise ops when these markers appear;
  // used only to hint that "strip existing" might be wanted.
  const looksNoisy = /_ERROR|DEPOLARIZE|PAULI_CHANNEL|HERALDED/.test(data?.circuit_text || '');

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const response = await fetch('/api/noise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuit_text: data.circuit_text,
          strip_existing: stripExisting,
          sources: enabledDefs.map(d => ({
            type: d.type,
            p: parseRate(rates[d.type]),
            ...(d.hasDuring ? { during } : {}),
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to apply noise');
      // Route through the live-edit path: keeps selection and measured data,
      // and flags which detector fractions the new noise changed.
      await handleLiveEdit(result.circuit_text);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  };

  const checkboxRow = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '11px 13px',
    background: C.field,
    border: `1px solid ${C.line}`,
    borderRadius: 8,
  };

  const rateInput = {
    width: 92,
    padding: '7px 9px',
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.lineStrong}`,
    borderRadius: 7,
    fontFamily: 'var(--mono)',
    fontSize: 12.5,
  };

  const secondaryButton = {
    padding: '9px 15px',
    background: C.field,
    color: C.textDim,
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 650,
    fontFamily: 'var(--display)',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(4, 7, 10, 0.74)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          borderRadius: 10,
          padding: 0,
          width: 'min(92vw, 640px)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderColor: C.lineStrong,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="instrument-strip"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            padding: '14px 18px',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="display-title" style={{ fontSize: 23, color: C.text, lineHeight: 1.02 }}>
              Add noise sources
            </div>
            <div style={{ color: C.textDim, fontSize: 12, marginTop: 5 }}>
              Insert noise channels into the circuit — each source independently, at its own rate.
              The rates become fittable parameters.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 34,
              height: 34,
              background: C.field,
              border: `1px solid ${C.line}`,
              borderRadius: 8,
              color: C.textDim,
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            &times;
          </button>
        </div>

        <div className="soft-scroll" style={{ padding: 18, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {SOURCE_DEFS.map(def => {
            const on = !!enabled[def.type];
            const badRate = on && parseRate(rates[def.type]) === null;
            return (
              <div key={def.type} style={{ ...checkboxRow, borderColor: badRate ? C.error : on ? C.accentDim : C.line }}>
                <input
                  type="checkbox"
                  id={`noise-${def.type}`}
                  checked={on}
                  onChange={e => setEnabled(prev => ({ ...prev, [def.type]: e.target.checked }))}
                  style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0, cursor: 'pointer' }}
                />
                <label htmlFor={`noise-${def.type}`} style={{ flex: 1, minWidth: 160, cursor: 'pointer' }}>
                  <div style={{ color: on ? C.text : C.textDim, fontSize: 13.5, fontWeight: 650 }}>
                    {def.label}
                  </div>
                  <div style={{ color: C.textFaint, fontSize: 11, marginTop: 2, fontFamily: 'var(--mono)' }}>
                    {def.detail}
                  </div>
                </label>
                {def.hasDuring && (
                  <select
                    value={during}
                    onChange={e => setDuring(e.target.value)}
                    disabled={!on}
                    aria-label="Idle noise applies during"
                    style={{
                      padding: '7px 8px',
                      background: C.bg,
                      color: on ? C.text : C.textFaint,
                      border: `1px solid ${C.lineStrong}`,
                      borderRadius: 7,
                      fontSize: 12,
                    }}
                  >
                    {DURING_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.textDim, fontSize: 12 }}>
                  p =
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rates[def.type]}
                    onChange={e => setRates(prev => ({ ...prev, [def.type]: e.target.value }))}
                    disabled={!on}
                    aria-label={`${def.label} probability`}
                    style={{ ...rateInput, opacity: on ? 1 : 0.5, borderColor: badRate ? C.error : C.lineStrong }}
                  />
                </label>
              </div>
            );
          })}

          <div style={{ ...checkboxRow, marginTop: 4 }}>
            <input
              type="checkbox"
              id="noise-strip"
              checked={stripExisting}
              onChange={e => setStripExisting(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.warning, flexShrink: 0, cursor: 'pointer' }}
            />
            <label htmlFor="noise-strip" style={{ flex: 1, cursor: 'pointer' }}>
              <div style={{ color: stripExisting ? C.text : C.textDim, fontSize: 13.5, fontWeight: 650 }}>
                Strip existing noise first
              </div>
              <div style={{ color: C.textFaint, fontSize: 11, marginTop: 2 }}>
                Removes current noise channels (and noise arguments on measurements) before
                inserting the sources above.{looksNoisy ? ' This circuit already contains noise.' : ''}
              </div>
            </label>
          </div>

          {error && (
            <div style={{
              color: C.error,
              fontSize: 12,
              padding: '9px 11px',
              background: C.errorSoft,
              borderRadius: 8,
              border: `1px solid ${C.error}`,
            }}>
              {error}
            </div>
          )}
        </div>

        <div
          className="instrument-strip"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '13px 18px',
            flexShrink: 0,
            borderBottom: 0,
            borderTop: `1px solid ${C.line}`,
            flexWrap: 'wrap',
          }}
        >
          <p style={{ color: C.textDim, fontSize: 11, margin: 0, flex: '1 1 240px' }}>
            The modified circuit replaces the current one; changed detector fractions are flagged.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply}
              style={{
                padding: '9px 16px',
                background: canApply
                  ? `linear-gradient(180deg, ${C.accent}, color-mix(in srgb, ${C.accent} 72%, ${C.bg}))`
                  : C.lineStrong,
                color: C.bg,
                border: `1px solid ${canApply ? C.accent : C.lineStrong}`,
                borderRadius: 8,
                cursor: canApply ? 'pointer' : 'default',
                fontSize: 13,
                fontWeight: 800,
                fontFamily: 'var(--display)',
                opacity: canApply ? 1 : 0.55,
              }}
            >
              {applying ? 'Applying…' : 'Apply noise'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
