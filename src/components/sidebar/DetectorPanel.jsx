import { useTheme } from '../../contexts/ThemeContext.jsx';

export default function DetectorPanel({ detectors, selectedDetector, setSelectedDetector }) {
  const { C } = useTheme();
  const avgEventFraction = detectors.length > 0
    ? detectors.reduce((sum, d) => sum + (d.event_fraction || 0), 0) / detectors.length
    : 0;
  const avgPercent = (avgEventFraction * 100).toFixed(2);

  return (
    <section
      className="glass-panel"
      style={{
        borderRadius: 10,
        padding: 14,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <div>
          <h2 className="display-title" style={{ margin: 0, fontSize: 19, color: C.text }}>Detectors</h2>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: C.textDim, fontSize: 11 }}>Average</div>
          <div style={{ color: C.error, fontSize: 16, fontWeight: 750, fontFamily: 'var(--mono)' }}>
            {avgPercent}%
          </div>
        </div>
      </div>

      <div
        className="soft-scroll"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 8,
          overflowY: 'auto',
          paddingRight: 2,
          maxHeight: '42vh',
        }}
      >
        {detectors.map(d => {
          const sel = selectedDetector === d.name;
          const eventPercent = ((d.event_fraction || 0) * 100).toFixed(2);
          return (
            <button
              key={d.name}
              onClick={() => setSelectedDetector(sel ? null : d.name)}
              style={{
                minHeight: 66,
                padding: '8px 7px',
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
                gap: 6,
                boxShadow: sel ? `0 0 0 1px ${C.amberSoft}, 0 12px 28px ${C.amberSoft}` : 'none',
                transition: 'background 140ms ease, border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: sel ? 20 : 15,
                  height: sel ? 20 : 15,
                  borderRadius: 999,
                  border: `1px solid ${sel ? C.detectorBright : C.lineStrong}`,
                  background: sel ? C.detector : C.fieldAlt,
                  boxShadow: sel ? `0 0 22px ${C.detector}` : 'inset 0 0 0 4px rgba(255,255,255,0.03)',
                  display: 'block',
                }}
              />
              <span style={{ fontWeight: 750, fontSize: 14, lineHeight: 1, fontFamily: 'var(--mono)' }}>{d.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: sel ? C.detectorBright : C.error, fontFamily: 'var(--mono)' }}>
                {eventPercent}%
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
