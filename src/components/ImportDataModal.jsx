import { useState, useMemo, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { parseMeasuredData, validateMeasuredData } from '../utils/measuredData.js';

const PLACEHOLDER = `# CSV: detector, measured event fraction
shots, 100000
D0, 0.0214
D1, 0.0198
D2, 0.0307

# or JSON: {"shots": 100000, "fractions": {"D0": 0.0214, ...}}
# or one bare fraction per line in detector order`;

export default function ImportDataModal({ onClose, onApply, onClear, detectors, measuredData }) {
  const { C } = useTheme();
  const [text, setText] = useState('');
  // Empty unless the user types here: a shots line in the pasted data must win
  // over the previous dataset's shot count, or re-imports at a new shot count
  // would silently keep stale z-scores.
  const [shotsText, setShotsText] = useState('');
  const fileInputRef = useRef(null);

  // Parse + validate on every keystroke so problems surface before Apply
  const { parsed, errors, warnings } = useMemo(() => {
    if (!text.trim()) return { parsed: null, errors: [], warnings: [] };
    let p;
    try {
      p = parseMeasuredData(text);
    } catch (err) {
      return { parsed: null, errors: [err.message], warnings: [] };
    }
    const shotsOverride = shotsText.trim();
    if (shotsOverride) {
      const v = Number(shotsOverride);
      if (!Number.isFinite(v) || v <= 0) {
        return { parsed: null, errors: [`Invalid shot count: "${shotsOverride}"`], warnings: [] };
      }
      p = { ...p, shots: v };
    } else if (p.shots == null && measuredData?.shots) {
      // Bare fractions inherit the current dataset's shot count.
      p = { ...p, shots: measuredData.shots };
    }
    const checks = validateMeasuredData(p, detectors);
    return { parsed: checks.errors.length ? null : p, errors: checks.errors, warnings: checks.warnings };
  }, [text, shotsText, detectors, measuredData]);

  const matchedCount = parsed ? Object.keys(parsed.fractions).length : 0;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setText);
    e.target.value = '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!parsed) return;
    onApply({ shots: parsed.shots ?? null, fractions: parsed.fractions });
    onClose();
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
          width: 'min(92vw, 680px)',
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
              Import measured data
            </div>
            <div style={{ color: C.textDim, fontSize: 12, marginTop: 5 }}>
              Per-detector measured event fractions to compare against the model.
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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div className="soft-scroll" style={{ padding: 18, overflow: 'auto', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
              <label style={{ color: C.textDim, fontSize: 12 }}>
                Measured fractions (CSV or JSON)
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{ ...secondaryButton, padding: '4px 10px', fontSize: 11 }}
              >
                Load file…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,.txt"
                onChange={handleFile}
                style={{ display: 'none' }}
              />
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              style={{
                ...inputBase,
                minHeight: 220,
                border: `1px solid ${errors.length ? C.error : C.lineStrong}`,
                padding: 13,
                resize: 'vertical',
                lineHeight: 1.55,
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <label style={{ color: C.textDim, fontSize: 12 }}>
                Shots
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={shotsText}
                onChange={e => setShotsText(e.target.value)}
                placeholder={measuredData?.shots ? `${measuredData.shots} (current dataset)` : 'e.g. 100000'}
                style={{ ...inputBase, width: 140, padding: '8px 10px' }}
              />
              <span style={{ color: C.textFaint, fontSize: 11 }}>
                Optional — enables σ error bars and z-scores. Overrides a shots line in the data.
              </span>
            </div>

            {(errors.length > 0 || warnings.length > 0 || parsed) && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {errors.map((msg, i) => (
                  <div key={`e${i}`} style={{
                    color: C.error,
                    fontSize: 12,
                    padding: '9px 11px',
                    background: C.errorSoft,
                    borderRadius: 8,
                    border: `1px solid ${C.error}`,
                  }}>
                    {msg}
                  </div>
                ))}
                {warnings.map((msg, i) => (
                  <div key={`w${i}`} style={{
                    color: C.warning,
                    fontSize: 12,
                    padding: '9px 11px',
                    background: C.amberSoft,
                    borderRadius: 8,
                    border: `1px solid ${C.lineWarm}`,
                  }}>
                    {msg}
                  </div>
                ))}
                {parsed && (
                  <div style={{
                    color: C.success,
                    fontSize: 12,
                    padding: '9px 11px',
                    background: C.field,
                    borderRadius: 8,
                    border: `1px solid ${C.line}`,
                  }}>
                    Parsed {matchedCount} detector{matchedCount !== 1 ? 's' : ''}
                    {parsed.shots ? ` · ${Number(parsed.shots).toLocaleString()} shots` : ''}
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
            <p style={{ color: C.textDim, fontSize: 11, margin: 0, flex: '1 1 240px' }}>
              {measuredData
                ? 'A dataset is currently loaded; applying replaces it.'
                : 'Detector cards will show measured vs model with residuals.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {measuredData && (
                <button
                  type="button"
                  onClick={() => { onClear(); onClose(); }}
                  style={{ ...secondaryButton, color: C.error, borderColor: C.errorSoft }}
                >
                  Remove data
                </button>
              )}
              <button type="button" onClick={onClose} style={secondaryButton}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={!parsed}
                style={{
                  padding: '9px 16px',
                  background: parsed
                    ? `linear-gradient(180deg, ${C.accent}, color-mix(in srgb, ${C.accent} 72%, ${C.bg}))`
                    : C.lineStrong,
                  color: C.bg,
                  border: `1px solid ${parsed ? C.accent : C.lineStrong}`,
                  borderRadius: 8,
                  cursor: parsed ? 'pointer' : 'default',
                  fontSize: 13,
                  fontWeight: 800,
                  fontFamily: 'var(--display)',
                  opacity: parsed ? 1 : 0.55,
                }}
              >
                Apply data
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
