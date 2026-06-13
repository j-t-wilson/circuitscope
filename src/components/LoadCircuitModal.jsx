import { useState, useMemo, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { validateCircuit } from '../utils/validateCircuit.js';
import Logo from './Logo.jsx';

// Launch screen: shown full-screen when no circuit is loaded, or as a
// dismissable overlay (logo click) over an intact workspace — pass onCancel
// for the latter. Once a circuit is analyzed, all editing happens in place in
// the Code view.
export default function LoadCircuitModal({
  onLoad,
  onCancel = null,
  isLoading,
  error,
  initialCircuit = '',
  examples = []
}) {
  const { C } = useTheme();
  const [selectedExampleId, setSelectedExampleId] = useState('');
  // Prefill with the last analyzed circuit (if any) so a returning visit
  // picks up where the previous session left off
  const [circuitText, setCircuitText] = useState(initialCircuit);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  // Drag enter/leave fire on every child; count nesting so the highlight
  // doesn't flicker while moving across the panel
  const dragDepth = useRef(0);

  const loadFileText = (file) => {
    if (!file) return;
    file.text().then(text => {
      setCircuitText(text);
      setSelectedExampleId('');
    });
  };

  const handleFile = (e) => {
    loadFileText(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    loadFileText(e.dataTransfer.files?.[0]);
  };

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
        background: onCancel ? 'rgba(4, 7, 10, 0.74)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onCancel || undefined}
      onDragEnter={handleDragEnter}
      onDragOver={e => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="glass-panel"
        onClick={e => e.stopPropagation()}
        style={{
          borderRadius: 10,
          padding: 0,
          width: 'min(92vw, 820px)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderColor: isDragging ? C.accent : C.lineStrong,
          boxShadow: isDragging ? `0 0 0 2px ${C.accentSoft}` : undefined,
        }}
      >
        <div
          className="instrument-strip"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            padding: '18px 20px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
            <Logo size={50} />
            <div style={{ minWidth: 0 }}>
              <div className="display-title" style={{ fontSize: 31, color: C.text, lineHeight: 1.02 }}>
                CircuitScope
              </div>
              <div style={{ color: C.textDim, fontSize: 12, marginTop: 5 }}>
                Load a Stim circuit to inspect detector event fractions.
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div className="soft-scroll" style={{ padding: 18, overflow: 'auto', minHeight: 0 }}>
            {examples.length > 0 && (
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
              <label style={{ color: C.textDim, fontSize: 12 }}>
                Stim circuit
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Load a .stim file (or drag one onto this window)"
                style={{
                  padding: '4px 10px',
                  background: C.field,
                  color: C.textDim,
                  border: `1px solid ${C.line}`,
                  borderRadius: 7,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 650,
                  fontFamily: 'var(--display)',
                }}
              >
                Load file…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".stim,.txt"
                onChange={handleFile}
                style={{ display: 'none' }}
              />
            </div>
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
                minHeight: 330,
                border: `1px solid ${isDragging ? C.accent : hasWarnings ? C.warning : (error ? C.error : C.lineStrong)}`,
                padding: 13,
                resize: 'vertical',
                lineHeight: 1.55,
                boxShadow: hasWarnings && !isDragging ? `0 0 0 1px ${C.amberSoft}` : 'none',
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
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
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
