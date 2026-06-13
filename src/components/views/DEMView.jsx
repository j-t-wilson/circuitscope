import { useTheme } from '../../contexts/ThemeContext.jsx';

export default function DEMView({ errors, selectedDetector, setSelectedDetector, onlySelected = false }) {
  const { C } = useTheme();

  const visibleErrors = onlySelected && selectedDetector
    ? errors.filter(e => e.dem_terms.some(t => t.target === selectedDetector))
    : errors;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {onlySelected && selectedDetector && (
        <div style={{ color: C.textDim, fontSize: 12, padding: '0 2px' }}>
          Showing {visibleErrors.length} of {errors.length} mechanisms involving{' '}
          <span style={{ color: C.detectorBright, fontFamily: 'var(--mono)', fontWeight: 700 }}>{selectedDetector}</span>
        </div>
      )}
      {visibleErrors.map((e, i) => {
        const rel = selectedDetector && e.dem_terms.some(t => t.target === selectedDetector);
        return (
          <div
            key={i}
            style={{
              padding: '13px 15px',
              background: rel
                ? `linear-gradient(180deg, ${C.amberSoft}, ${C.field})`
                : `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
              borderRadius: 8,
              border: `1px solid ${rel ? C.detector : C.line}`,
              boxShadow: rel ? `0 0 0 1px ${C.amberSoft}` : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                {e.dem_terms.map((t, ti) => {
                  const isDetectorTarget = t.target.startsWith('D');
                  const isSel = t.target === selectedDetector;
                  const chip = isDetectorTarget ? (
                    <button
                      onClick={() => setSelectedDetector(isSel ? null : t.target)}
                      title={isSel ? `Deselect ${t.target}` : `Select ${t.target}`}
                      style={{
                        padding: '2px 8px',
                        background: isSel ? C.amberSoft : C.field,
                        color: isSel ? C.detectorBright : C.detector,
                        border: `1px solid ${isSel ? C.detectorBright : C.lineStrong}`,
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontWeight: 750,
                        fontSize: 13,
                        fontFamily: 'var(--mono)',
                        transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
                      }}
                    >
                      {t.target}
                    </button>
                  ) : (
                    <span style={{ color: C.observable, fontWeight: 750, fontSize: 13, fontFamily: 'var(--mono)' }}>
                      {t.target}
                    </span>
                  );
                  return (
                    <span key={ti} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {ti > 0 && <span style={{ color: C.textDim, fontSize: 12 }}>⊗</span>}
                      {chip}
                    </span>
                  );
                })}
              </span>
              <span style={{ color: C.error, fontSize: 12, fontFamily: 'var(--mono)', flexShrink: 0 }}>
                {e.probability != null
                  ? e.probability.toExponential(2)
                  : (e.locations.reduce((sum, l) => sum + (l.rate || 0), 0)).toExponential(2)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
              {[...new Set(e.locations.map(l => l.instruction))].map((inst, j) => (
                <span key={j} style={{ marginRight: 10 }}>
                  <span style={{ color: C.error, fontFamily: 'var(--mono)' }}>err</span> {inst}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {visibleErrors.length === 0 && (
        <div style={{ color: C.textDim, fontSize: 13, padding: '12px 4px' }}>
          No error mechanisms involve {selectedDetector}.
        </div>
      )}
    </div>
  );
}
