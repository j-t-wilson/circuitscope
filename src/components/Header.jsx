import { useTheme } from '../contexts/ThemeContext.jsx';
import Logo from './Logo.jsx';

const VIEW_LABELS = {
  timeline: 'Timeline',
  analysis: 'Analysis',
  code: 'Code',
  dem: 'DEM',
};

export default function Header({ viewMode, setViewMode, onLoadClick, onLogoClick }) {
  const { C, isDark, toggleTheme } = useTheme();

  const controlButton = (active = false) => ({
    minHeight: 34,
    padding: '7px 12px',
    background: active
      ? `linear-gradient(180deg, ${C.detectorBright}, ${C.detector})`
      : C.glass,
    color: active ? C.bg : C.text,
    border: `1px solid ${active ? C.detectorBright : C.line}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    fontFamily: 'var(--display)',
    transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease',
    boxShadow: active ? `0 0 0 1px ${C.amberSoft}, 0 10px 28px ${C.amberSoft}` : 'none',
  });

  return (
    <header
      className="glass-panel app-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 16,
        padding: '12px 14px 12px 16px',
        borderRadius: 10,
        flexWrap: 'wrap',
      }}
    >
      <button
        className="brand-button"
        onClick={onLogoClick}
        title="Return to start"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: C.text,
        }}
      >
        <Logo size={38} />
        <span className="brand-copy" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span
            className="display-title brand-wordmark"
            style={{
              fontSize: 28,
              lineHeight: 1,
              color: C.text,
            }}
          >
            CircuitScope
          </span>
        </span>
      </button>

      <div className="header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <div
          className="view-switcher"
          style={{
            display: 'flex',
            gap: 6,
            padding: 4,
            background: C.field,
            border: `1px solid ${C.line}`,
            borderRadius: 10,
          }}
        >
          {Object.entries(VIEW_LABELS).map(([mode, label]) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                className="view-button"
                onClick={() => setViewMode(mode)}
                style={controlButton(active)}
              >
                {label}
              </button>
            );
          })}
        </div>

        <button
          className="theme-button"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            ...controlButton(false),
            width: 36,
            padding: 0,
            color: C.detector,
            fontSize: 16,
          }}
        >
          {isDark ? '\u2600' : '\u263E'}
        </button>

        <button
          className="edit-circuit-button"
          onClick={onLoadClick}
          style={{
            ...controlButton(false),
            whiteSpace: 'nowrap',
            background: `linear-gradient(180deg, ${C.accent}, color-mix(in srgb, ${C.accent} 72%, ${C.bg}))`,
            color: C.bg,
            border: `1px solid ${C.accent}`,
            fontWeight: 750,
          }}
        >
          Edit circuit
        </button>
      </div>
    </header>
  );
}
