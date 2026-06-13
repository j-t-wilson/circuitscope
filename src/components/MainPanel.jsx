import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { viewAccent } from '../constants/theme.js';
import { copyText } from '../utils/clipboard.js';
import Timeline from './timeline/Timeline.jsx';
import CodeView from './views/CodeView.jsx';
import DEMView from './views/DEMView.jsx';
import AnalysisView from './views/AnalysisView.jsx';
import CompareView from './views/CompareView.jsx';

const TITLE_BY_MODE = {
  timeline: 'Circuit timeline',
  code: 'Stim source',
  dem: 'Detector error model',
  analysis: 'Analytical response',
  compare: 'Measured data comparison',
};

// Concrete font stacks substituted for CSS variables when exporting the
// timeline SVG, since standalone files can't resolve the app's custom props
const FONT_MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace";
const FONT_DISPLAY = "'Source Serif 4', Georgia, serif";

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

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
  setShowDetectingRegions,
  propagation,
  toggleErrorPropagation,
  selectPropagationComponent,
  clearPropagation
}) {
  const { C } = useTheme();
  const [copyStatus, setCopyStatus] = useState(null);
  const [demOnlySelected, setDemOnlySelected] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const timelineSvgRef = useRef(null);
  const exportMenuRef = useRef(null);
  const scrollRef = useRef(null);
  // Pending scroll correction for cursor-anchored wheel zoom, applied after
  // the timeline re-renders at the new zoom (all SVG coordinates scale
  // linearly with zoom, so the visible point moves by exactly newZoom/oldZoom)
  const zoomAnchorRef = useRef(null);
  const SCROLL_PAD = 18; // padding of the scroll container

  const clampZoom = z => Math.min(2, Math.max(0.3, z));

  const handleFitWidth = () => {
    const svg = timelineSvgRef.current;
    const scroller = scrollRef.current;
    if (!svg || !scroller) return;
    const svgWidth = parseFloat(svg.getAttribute('width'));
    const available = scroller.clientWidth - 2 * SCROLL_PAD;
    if (!svgWidth || available <= 0) return;
    setZoom(clampZoom(zoom * available / svgWidth));
  };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || viewMode !== 'timeline') return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = scroller.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0022);
      setZoom(z => {
        const next = clampZoom(z * factor);
        if (next !== z) zoomAnchorRef.current = { x, y, ratio: next / z };
        return next;
      });
    };
    // Native listener: wheel events must be non-passive to preventDefault
    // (browser pinch-zoom), which React's synthetic onWheel can't guarantee
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [viewMode, setZoom]);

  // Close the export-format menu on outside click or Escape
  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!exportMenuRef.current?.contains(e.target)) setExportMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setExportMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportMenuOpen]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;
    zoomAnchorRef.current = null;
    const { x, y, ratio } = anchor;
    scroller.scrollLeft = (scroller.scrollLeft + x - SCROLL_PAD) * ratio + SCROLL_PAD - x;
    scroller.scrollTop = (scroller.scrollTop + y - SCROLL_PAD) * ratio + SCROLL_PAD - y;
  }, [zoom]);

  // Serialize the live timeline SVG into a standalone document: opaque
  // backdrop, pinned labels reset to the origin, CSS font vars inlined.
  const buildTimelineSvgMarkup = () => {
    const svg = timelineSvgRef.current;
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.querySelector('[data-pinned-labels]')?.setAttribute('transform', 'translate(0, 0)');
    const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    backdrop.setAttribute('width', svg.getAttribute('width'));
    backdrop.setAttribute('height', svg.getAttribute('height'));
    backdrop.setAttribute('fill', C.field);
    clone.insertBefore(backdrop, clone.firstChild);
    return new XMLSerializer()
      .serializeToString(clone)
      .replaceAll('var(--mono)', FONT_MONO)
      .replaceAll('var(--display)', FONT_DISPLAY);
  };

  const handleExportSvg = () => {
    const markup = buildTimelineSvgMarkup();
    if (!markup) return;
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    triggerDownload(url, 'circuitscope-timeline.svg');
    URL.revokeObjectURL(url);
  };

  const handleExportPng = () => {
    const svg = timelineSvgRef.current;
    const markup = buildTimelineSvgMarkup();
    if (!svg || !markup) return;
    const scale = 2;
    const width = Math.round(parseFloat(svg.getAttribute('width')) * scale);
    const height = Math.round(parseFloat(svg.getAttribute('height')) * scale);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        triggerDownload(pngUrl, 'circuitscope-timeline.png');
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

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
    setCopyStatus((await copyText(data.circuit_text)) ? 'copied' : 'error');
    setTimeout(() => setCopyStatus(null), 2000);
  };

  const regionSegments = (viewMode === 'timeline' && showDetectingRegions && selectedDetector)
    ? data.detecting_regions?.[selectedDetector]
    : null;
  const showLegend = regionSegments?.length > 0;
  const regionPaulis = showLegend ? new Set(regionSegments.map(s => s.pauli)) : null;
  const showRegionsHint = viewMode === 'timeline' && showDetectingRegions && !selectedDetector;
  const showPropagation = viewMode === 'timeline' && propagation;

  const propagationStatusText = () => {
    if (propagation.components.length === 0) return 'flips no detectors';
    if (propagation.status === 'loading') return '…';
    if (propagation.status === 'error') return propagation.error || 'propagation failed';
    return propagation.flippedDetectors.length
      ? `→ flips ${propagation.flippedDetectors.join(', ')}`
      : '→ flips no detectors';
  };

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
          {/* Accent bar in the view's own hue, matching the active header tab */}
          <div
            style={{
              width: 9,
              height: 30,
              borderRadius: 99,
              background: viewAccent(C, viewMode).gradient,
              boxShadow: `0 0 24px ${viewAccent(C, viewMode).soft}`,
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
            {[
              ['Z', C.qubit, 'Z sensitivity'],
              ['X', C.error, 'X sensitivity'],
              ['Y', C.warning, 'Y sensitivity'],
            ].filter(([pauli]) => regionPaulis.has(pauli)).map(([pauli, color, label]) => (
              <div key={pauli} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 18, height: 8, background: color, opacity: 0.5, borderRadius: 99 }} />
                <span style={{ color: C.textDim, fontSize: 11 }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {showRegionsHint && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, justifyContent: 'center', minWidth: 180 }}>
            <span style={{ color: C.textDim, fontSize: 11, fontStyle: 'italic' }}>
              Select a detector to see its detecting regions
            </span>
          </div>
        )}

        {showPropagation && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, justifyContent: 'center', minWidth: 220, flexWrap: 'wrap' }}>
            <span style={{ color: C.textDim, fontSize: 11, fontFamily: 'var(--mono)' }}>
              {propagation.source.name} t={propagation.source.tick}
            </span>
            {propagation.components.map(component => {
              const active = component.pauli === propagation.activePauli;
              return (
                <button
                  key={component.pauli}
                  onClick={() => selectPropagationComponent(component.pauli)}
                  title={component.detectors.length
                    ? `${component.pauli} flips ${component.detectors.join(', ')}`
                    : `${component.pauli} flips no detectors`}
                  style={{
                    ...buttonBase,
                    minHeight: 24,
                    padding: '3px 8px',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    background: active ? C.amberSoft : C.field,
                    color: active ? C.detectorBright : C.textDim,
                    border: `1px solid ${active ? C.detector : C.line}`,
                  }}
                >
                  {component.pauli}
                </button>
              );
            })}
            <span style={{ color: propagation.status === 'error' ? C.error : C.textDim, fontSize: 11, fontFamily: 'var(--mono)' }}>
              {propagationStatusText()}
            </span>
            <button
              onClick={clearPropagation}
              aria-label="Dismiss error propagation"
              title="Dismiss error propagation"
              style={{ ...buttonBase, minHeight: 24, width: 24, padding: 0, color: C.textDim }}
            >
              ✕
            </button>
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
          {viewMode === 'dem' && selectedDetector && (
            <button
              onClick={() => setDemOnlySelected(v => !v)}
              title={demOnlySelected ? 'Show all error mechanisms' : `Show only mechanisms involving ${selectedDetector}`}
              style={{
                ...buttonBase,
                padding: '6px 11px',
                background: demOnlySelected ? C.amberSoft : C.field,
                color: demOnlySelected ? C.detectorBright : C.textDim,
                border: `1px solid ${demOnlySelected ? C.detector : C.line}`,
              }}
            >
              Only {selectedDetector}
            </button>
          )}
          {viewMode === 'timeline' && (
            <>
              <button
                onClick={() => setShowDetectingRegions(v => !v)}
                title="Overlay the selected detector's detecting regions (which qubit Paulis it is sensitive to, and when)"
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
              <div ref={exportMenuRef} style={{ position: 'relative', display: 'flex' }}>
                <button
                  onClick={() => setExportMenuOpen(v => !v)}
                  aria-label="Save timeline as an image"
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                  title="Save timeline as an image"
                  style={{
                    ...buttonBase,
                    padding: '6px 9px',
                    display: 'flex',
                    alignItems: 'center',
                    background: exportMenuOpen ? C.amberSoft : C.field,
                    color: exportMenuOpen ? C.detectorBright : C.textDim,
                    border: `1px solid ${exportMenuOpen ? C.detector : C.line}`,
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </button>
                {exportMenuOpen && (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      zIndex: 20,
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 132,
                      padding: 5,
                      background: C.bgLighter || C.field,
                      border: `1px solid ${C.line}`,
                      borderRadius: 9,
                      boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
                      gap: 3,
                    }}
                  >
                    <div style={{ padding: '3px 9px 4px', fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: C.textDim, fontFamily: 'var(--display)' }}>
                      Save image as
                    </div>
                    {[
                      ['SVG', 'Vector — scales losslessly', handleExportSvg],
                      ['PNG', 'Raster bitmap at 2× resolution', handleExportPng],
                    ].map(([label, hint, handler]) => (
                      <button
                        key={label}
                        role="menuitem"
                        onClick={() => { handler(); setExportMenuOpen(false); }}
                        title={hint}
                        style={{
                          ...buttonBase,
                          background: 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          padding: '6px 9px',
                          color: C.text,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = C.field; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{label}</span>
                        <span style={{ fontSize: 10, color: C.textDim }}>{hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleFitWidth}
                aria-label="Fit timeline width to the window"
                title="Fit the circuit width to the window"
                style={{ ...zoomBtn, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="5" x2="3" y2="19" />
                  <line x1="21" y1="5" x2="21" y2="19" />
                  <polyline points="9 8 5 12 9 16" />
                  <polyline points="15 8 19 12 15 16" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button onClick={() => setZoom(z => clampZoom(z - 0.1))} style={zoomBtn} aria-label="Zoom out" title="Zoom out (or ⌘/Ctrl-scroll on the timeline)">-</button>
              <button
                onClick={() => setZoom(0.7)}
                title="Reset zoom to 100%"
                style={{
                  ...buttonBase,
                  border: 'none',
                  background: 'transparent',
                  color: C.textDim,
                  fontSize: 12,
                  minWidth: 42,
                  padding: 0,
                  textAlign: 'center',
                  fontFamily: 'var(--mono)',
                }}
              >
                {Math.round(zoom / 0.7 * 100)}%
              </button>
              <button onClick={() => setZoom(z => clampZoom(z + 0.1))} style={zoomBtn} aria-label="Zoom in" title="Zoom in (or ⌘/Ctrl-scroll on the timeline)">+</button>
            </>
          )}
        </div>
      </div>
      <div ref={scrollRef} className="soft-scroll" style={{ padding: SCROLL_PAD, overflow: 'auto', flex: 1, minHeight: 0 }}>
        {viewMode === 'timeline' && (
          <Timeline
            data={data}
            svgRef={timelineSvgRef}
            zoom={zoom}
            selectedDetector={selectedDetector}
            highlighted={highlighted}
            highlightedMeasurements={highlightedMeasurements}
            setSelectedDetector={setSelectedDetector}
            hoveredDetector={hoveredDetector}
            setHoveredDetector={setHoveredDetector}
            showDetectingRegions={showDetectingRegions}
            propagation={propagation}
            onErrorToggle={toggleErrorPropagation}
          />
        )}
        {viewMode === 'code' && <CodeView code={data.circuit_text} selectedDetector={selectedDetector} />}
        {viewMode === 'dem' && <DEMView errors={data.detector_errors} selectedDetector={selectedDetector} setSelectedDetector={setSelectedDetector} onlySelected={demOnlySelected} />}
        {viewMode === 'analysis' && <AnalysisView data={data} selectedDetector={selectedDetector} setSelectedDetector={setSelectedDetector} />}
        {viewMode === 'compare' && <CompareView />}
      </div>
    </section>
  );
}
