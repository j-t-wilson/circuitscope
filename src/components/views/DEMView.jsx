import { useTheme } from '../../contexts/ThemeContext.jsx';

export default function DEMView({ errors, selectedDetector, setSelectedDetector }) {
  const { C } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {errors.map((e, i) => {
        const dets = e.dem_terms.map(t => t.target).join(' ⊗ ');
        const rel = selectedDetector && e.dem_terms.some(t => t.target === selectedDetector);
        return (
          <div
            key={i}
            onClick={() => {
              const d = e.dem_terms[0]?.target;
              if (d?.startsWith('D')) setSelectedDetector(selectedDetector === d ? null : d);
            }}
            style={{
              padding: '13px 15px',
              background: rel
                ? `linear-gradient(180deg, ${C.amberSoft}, ${C.field})`
                : `linear-gradient(180deg, ${C.glassStrong}, ${C.field})`,
              borderRadius: 8,
              border: `1px solid ${rel ? C.detector : C.line}`,
              cursor: 'pointer',
              boxShadow: rel ? `0 0 0 1px ${C.amberSoft}` : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <span style={{ color: rel ? C.detectorBright : C.detector, fontWeight: 750, fontSize: 14, fontFamily: 'var(--mono)' }}>{dets}</span>
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
    </div>
  );
}
