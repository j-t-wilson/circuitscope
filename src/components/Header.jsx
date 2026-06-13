import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { viewAccent } from '../constants/theme.js';
import { buildShareUrl } from '../utils/shareState.js';
import { copyText } from '../utils/clipboard.js';
import Logo from './Logo.jsx';

const VIEW_LABELS = {
  timeline: 'Timeline',
  analysis: 'Analysis',
  compare: 'Compare',
  code: 'Code',
  dem: 'DEM',
};

export default function Header({ viewMode, setViewMode, onLogoClick, onImportClick, onNoiseClick, hasMeasuredData, circuitText, selectedDetector }) {
  const { C, isDark, toggleTheme } = useTheme();
  const [linkStatus, setLinkStatus] = useState(null);

  const handleCopyLink = async () => {
    const url = buildShareUrl(circuitText, selectedDetector);
    const status = !url ? 'toolong' : (await copyText(url)) ? 'copied' : 'error';
    setLinkStatus(status);
    setTimeout(() => setLinkStatus(null), 2000);
  };

  // The active view tab tints to its view's accent (see viewAccent), so the
  // tab you click and the title bar you land on agree.
  const controlButton = (active = false, accent = null) => ({
    minHeight: 34,
    padding: '7px 12px',
    background: active ? accent.gradient : C.glass,
    color: active ? C.bg : C.text,
    border: `1px solid ${active ? accent.main : C.line}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    fontFamily: 'var(--display)',
    transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease',
    boxShadow: active ? `0 0 0 1px ${accent.soft}, 0 10px 28px ${accent.soft}` : 'none',
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
        title="Load a different circuit"
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
                style={controlButton(active, viewAccent(C, mode))}
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
          className="add-noise-button"
          onClick={onNoiseClick}
          title="Insert composable noise sources into the circuit (or strip existing noise)"
          style={{
            ...controlButton(false),
            whiteSpace: 'nowrap',
          }}
        >
          Noise
        </button>

        <button
          className="import-data-button"
          onClick={onImportClick}
          title={hasMeasuredData ? 'Measured data loaded — click to replace or remove' : 'Import measured detector fractions to compare against the model'}
          style={{
            ...controlButton(false),
            whiteSpace: 'nowrap',
            color: hasMeasuredData ? C.bg : C.text,
            background: hasMeasuredData
              ? `linear-gradient(180deg, ${C.measure}, color-mix(in srgb, ${C.measure} 72%, ${C.bg}))`
              : C.glass,
            border: `1px solid ${hasMeasuredData ? C.measure : C.line}`,
            fontWeight: hasMeasuredData ? 750 : 600,
          }}
        >
          {hasMeasuredData ? 'Data ✓' : 'Import data'}
        </button>

        <button
          className="copy-link-button"
          onClick={handleCopyLink}
          title="Copy a shareable link to this circuit (the URL encodes the circuit and selected detector)"
          style={{
            ...controlButton(false),
            whiteSpace: 'nowrap',
            background: linkStatus === 'copied' ? C.success : C.glass,
            color: linkStatus === 'copied' ? C.bg : C.text,
            border: `1px solid ${linkStatus === 'copied' ? C.success : C.line}`,
          }}
        >
          {linkStatus === 'copied' ? 'Copied ✓'
            : linkStatus === 'toolong' ? 'Circuit too large'
            : linkStatus === 'error' ? 'Copy failed'
            : 'Copy link'}
        </button>
      </div>
    </header>
  );
}
