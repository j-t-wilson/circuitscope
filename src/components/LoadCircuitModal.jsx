import { useState, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { validateCircuit } from '../utils/validateCircuit.js';
import Logo from './Logo.jsx';

export default function LoadCircuitModal({
  onClose,
  onLoad,
  isLoading,
  error,
  isLaunchMode = false,
  defaultCircuit = '',
  currentCircuit = '',
  examples = [],
  defaultExampleId = null
}) {
  const { C } = useTheme();
  const [selectedExampleId, setSelectedExampleId] = useState(isLaunchMode ? '' : defaultExampleId);
  const [circuitText, setCircuitText] = useState(isLaunchMode ? '' : currentCircuit);

  const handleExampleChange = (e) => {
    const exampleId = e.target.value;
    setSelectedExampleId(exampleId);
    const example = examples.find(p => p.id === exampleId);
    if (example) {
      setCircuitText(example.circuit);
    }
  };

  const circuitWarnings = useMemo(() => {
    return validateCircuit(circuitText);
  }, [circuitText]);

  const hasWarnings = circuitWarnings.length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (circuitText.trim()) {
      onLoad(circuitText);
    }
  };

  const inputBase = {
    width: '100%',
    background: C.field,
    color: C.text,
    border: `1px solid ${C.lineStrong}`,
    borderRadius: 8,
    fontFamily: 'var(--mono)',
    fontSize: 13,
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: isLaunchMode
          ? 'transparent'
          : 'rgba(4, 7, 10, 0.74)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={isLaunchMode ? undefined : onClose}
    >
      <div
        className="glass-panel"
        style={{
          borderRadius: 10,
          padding: 0,
          width: 'min(92vw, 820px)',
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
            padding: isLaunchMode ? '18px 20px' : '14px 18px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
            <Logo size={isLaunchMode ? 50 : 36} />
            <div style={{ minWidth: 0 }}>
              <div className="display-title" style={{ fontSize: isLaunchMode ? 31 : 23, color: C.text, lineHeight: 1.02 }}>
                {isLaunchMode ? 'CircuitScope' : 'Edit circuit'}
              </div>
              <div style={{ color: C.textDim, fontSize: 12, marginTop: 5 }}>
                {isLaunchMode
                  ? 'Load a Stim circuit to inspect detector event fractions.'
                  : 'Modify the Stim source and re-run analysis.'}
              </div>
            </div>
          </div>
          {!isLaunchMode && (
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
              }}
            >
              &times;
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div className="soft-scroll" style={{ padding: 18, overflow: 'auto', minHeight: 0 }}>
            {isLaunchMode && examples.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', color: C.textDim, fontSize: 12, marginBottom: 7 }}>
                  Example circuit
                </label>
                <select
                  value={selectedExampleId || ''}
                  onChange={handleExampleChange}
                  style={{
                    ...inputBase,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    appearance: 'none',
                    backgroundImage: `linear-gradient(45deg, transparent 50%, ${C.textDim} 50%), linear-gradient(135deg, ${C.textDim} 50%, transparent 50%)`,
                    backgroundPosition: 'calc(100% - 18px) 50%, calc(100% - 12px) 50%',
                    backgroundSize: '6px 6px, 6px 6px',
                    backgroundRepeat: 'no-repeat',
                    paddingRight: 38,
                  }}
                >
                  <option value="" disabled>Choose an example...</option>
                  {examples.map(example => (
                    <option key={example.id} value={example.id} title={example.description}>
                      {example.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label style={{ display: 'block', color: C.textDim, fontSize: 12, marginBottom: 7 }}>
              Stim circuit
            </label>
            <textarea
              value={circuitText}
              onChange={e => setCircuitText(e.target.value)}
              placeholder={`R 0 1 2
TICK
CX 0 1
TICK
M 0 1 2
DETECTOR rec[-1] rec[-2]`}
              style={{
                ...inputBase,
                minHeight: isLaunchMode ? 330 : 300,
                border: `1px solid ${hasWarnings ? C.warning : (error ? C.error : C.lineStrong)}`,
                padding: 13,
                resize: 'vertical',
                lineHeight: 1.55,
                boxShadow: hasWarnings ? `0 0 0 1px ${C.amberSoft}` : 'none',
              }}
              disabled={isLoading}
            />

            {(hasWarnings || error) && (
              <div style={{
                marginTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                {circuitWarnings.map((warning, i) => (
                  <div
                    key={i}
                    style={{
                      color: C.warning,
                      fontSize: 12,
                      padding: '9px 11px',
                      background: C.amberSoft,
                      borderRadius: 8,
                      border: `1px solid ${C.lineWarm}`
                    }}
                  >
                    <strong>Warning:</strong> {warning.message}
                  </div>
                ))}
                {error && (
                  <div style={{
                    color: C.error,
                    fontSize: 12,
                    padding: '9px 11px',
                    background: C.errorSoft,
                    borderRadius: 8,
                    border: `1px solid ${C.error}`
                  }}>
                    Error: {error}
                  </div>
                )}
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
            <p style={{
              color: C.textDim,
              fontSize: 11,
              margin: 0,
              flex: '1 1 280px',
            }}>
              Tip: Place TICK commands between sequential operations and keep DETECTORs close to their measurements.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {!isLaunchMode && (
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '9px 15px',
                    background: C.field,
                    color: C.textDim,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 650,
                    fontFamily: 'var(--display)',
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={isLoading || !circuitText.trim()}
                style={{
                  padding: '9px 16px',
                  background: isLoading
                    ? C.lineStrong
                    : `linear-gradient(180deg, ${C.accent}, color-mix(in srgb, ${C.accent} 72%, ${C.bg}))`,
                  color: C.bg,
                  border: `1px solid ${isLoading ? C.lineStrong : C.accent}`,
                  borderRadius: 8,
                  cursor: isLoading ? 'wait' : 'pointer',
                  fontSize: 13,
                  fontWeight: 800,
                  fontFamily: 'var(--display)',
                  opacity: !circuitText.trim() ? 0.55 : 1,
                }}
              >
                {isLoading ? 'Analyzing...' : 'Analyze circuit'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
