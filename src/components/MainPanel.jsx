import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import Timeline from './timeline/Timeline.jsx';
import CodeView from './views/CodeView.jsx';
import DEMView from './views/DEMView.jsx';
import AnalysisView from './views/AnalysisView.jsx';

const TITLE_BY_MODE = {
  timeline: 'Circuit timeline',
  code: 'Stim source',
  dem: 'Detector error model',
  analysis: 'Analytical response',
};

export default function MainPanel({
  viewMode,
  data,
  zoom,
  setZoom,
  selectedDetector,
  highlighted,
  highlightedMeasurements,
  setSelectedDetector,
  hoveredDetector,
  setHoveredDetector,
  showDetectingRegions,
  setShowDetectingRegions
}) {
  const { C } = useTheme();
  const [copyStatus, setCopyStatus] = useState(null);

  const buttonBase = {
    minHeight: 30,
    background: C.field,
    border: `1px solid ${C.line}`,
    borderRadius: 7,
    color: C.text,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 650,
    fontFamily: 'var(--display)',
    transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
  };

  const zoomBtn = {
    ...buttonBase,
    width: 30,
    padding: 0,
    color: C.textDim,
    fontSize: 17,
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(data.circuit_text);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  const showLegend = viewMode === 'timeline' && showDetectingRegions && selectedDetector && data.detecting_regions?.[selectedDetector];

  return (
    <section
      className="glass-panel"
      style={{
        borderRadius: 10,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div
        className="instrument-strip"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 180 }}>
          <div
            style={{
              width: 9,
              height: 30,
              borderRadius: 99,
              background: viewMode === 'timeline'
                ? `linear-gradient(180deg, ${C.detectorBright}, ${C.detector})`
                : `linear-gradient(180deg, ${C.accent}, ${C.accentDim})`,
              boxShadow: viewMode === 'timeline' ? `0 0 24px ${C.amberSoft}` : `0 0 22px ${C.accentSoft}`,
            }}
          />
          <div>
            <div className="display-title" style={{ color: C.text, fontSize: 18 }}>
              {TITLE_BY_MODE[viewMode]}
            </div>
          </div>
        </div>

        {showLegend && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: 'center', minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 18, height: 8, background: C.qubit, opacity: 0.5, borderRadius: 99 }} />
              <span style={{ color: C.textDim, fontSize: 11 }}>Z sensitivity</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 18, height: 8, background: C.error, opacity: 0.5, borderRadius: 99 }} />
              <span style={{ color: C.textDim, fontSize: 11 }}>X sensitivity</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {viewMode === 'code' && (
            <button
              onClick={handleCopyCode}
              style={{
                ...buttonBase,
                padding: '6px 11px',
                background: copyStatus === 'copied' ? C.success : C.field,
                color: copyStatus === 'copied' ? C.bg : C.text,
                border: `1px solid ${copyStatus === 'copied' ? C.success : C.line}`,
              }}
            >
              {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Error' : 'Copy'}
            </button>
          )}
          {viewMode === 'timeline' && (
            <>
              <button
                onClick={() => setShowDetectingRegions(v => !v)}
                style={{
                  ...buttonBase,
                  padding: '6px 11px',
                  background: showDetectingRegions ? C.amberSoft : C.field,
                  color: showDetectingRegions ? C.detectorBright : C.textDim,
                  border: `1px solid ${showDetectingRegions ? C.detector : C.line}`,
                }}
              >
                Regions
              </button>
              <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} style={zoomBtn} aria-label="Zoom out">-</button>
              <span style={{ color: C.textDim, fontSize: 12, minWidth: 42, textAlign: 'center', fontFamily: 'var(--mono)' }}>
                {Math.round(zoom / 0.7 * 100)}%
              </span>
              <button onClick={() => setZoom(z => Math.min(2, z + 0.1))} style={zoomBtn} aria-label="Zoom in">+</button>
            </>
          )}
        </div>
      </div>
      <div className="soft-scroll" style={{ padding: 18, overflow: 'auto', flex: 1, minHeight: 0 }}>
        {viewMode === 'timeline' && (
          <Timeline
            data={data}
            zoom={zoom}
            selectedDetector={selectedDetector}
            highlighted={highlighted}
            highlightedMeasurements={highlightedMeasurements}
            setSelectedDetector={setSelectedDetector}
            hoveredDetector={hoveredDetector}
            setHoveredDetector={setHoveredDetector}
            showDetectingRegions={showDetectingRegions}
          />
        )}
        {viewMode === 'code' && <CodeView code={data.circuit_text} selectedDetector={selectedDetector} />}
        {viewMode === 'dem' && <DEMView errors={data.detector_errors} selectedDetector={selectedDetector} setSelectedDetector={setSelectedDetector} />}
        {viewMode === 'analysis' && <AnalysisView data={data} selectedDetector={selectedDetector} setSelectedDetector={setSelectedDetector} />}
      </div>
    </section>
  );
}
