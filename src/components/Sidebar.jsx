import { useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import DetectorPanel from './sidebar/DetectorPanel.jsx';
import ErrorDetails from './sidebar/ErrorDetails.jsx';

const SPLIT_KEY = 'circuitscope-sidebar-split';
const DEFAULT_SPLIT = 0.45;
const clampSplit = (v) => Math.min(0.78, Math.max(0.22, v));

export default function Sidebar({ data, detectors, modelModified, selectedDetector, setSelectedDetector, setHoveredDetector, setHoveredMechanism, relevantErrors, detailedBudgets, comparison, monteCarlo, fractionDeltas }) {
  const { C } = useTheme();
  const asideRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  // Fraction of the sidebar height given to the detector panel
  const [split, setSplit] = useState(() => {
    const stored = parseFloat(localStorage.getItem(SPLIT_KEY) ?? '');
    return Number.isFinite(stored) ? clampSplit(stored) : DEFAULT_SPLIT;
  });

  const showDetails = selectedDetector && selectedDetector !== 'Average';

  const startDrag = (e) => {
    const rect = asideRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    e.preventDefault();
    setDragging(true);
    const fracAt = (clientY) => clampSplit((clientY - rect.top) / rect.height);
    const onMove = (ev) => setSplit(fracAt(ev.clientY));
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
      localStorage.setItem(SPLIT_KEY, fracAt(ev.clientY).toFixed(3));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resetSplit = () => {
    setSplit(DEFAULT_SPLIT);
    localStorage.setItem(SPLIT_KEY, String(DEFAULT_SPLIT));
  };

  return (
    <aside
      ref={asideRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        userSelect: dragging ? 'none' : undefined,
      }}
    >
      <div style={{ flex: showDetails ? `${split} 1 0px` : '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <DetectorPanel
          detectors={detectors ?? data.detectors}
          nominalDetectors={data.detectors}
          modelModified={modelModified}
          selectedDetector={selectedDetector}
          setSelectedDetector={setSelectedDetector}
          setHoveredDetector={setHoveredDetector}
          comparison={comparison}
          monteCarlo={monteCarlo}
          fractionDeltas={fractionDeltas}
        />
      </div>
      {showDetails && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize · double-click to reset"
            onPointerDown={startDrag}
            onDoubleClick={resetSplit}
            style={{
              height: 14,
              flexShrink: 0,
              cursor: 'row-resize',
              touchAction: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 44,
                height: 4,
                borderRadius: 99,
                background: dragging ? C.detector : C.lineStrong,
                transition: 'background 140ms ease',
              }}
            />
          </div>
          <div style={{ flex: `${1 - split} 1 0px`, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ErrorDetails
              detector={selectedDetector}
              errors={relevantErrors}
              detailedBudget={detailedBudgets?.[selectedDetector]}
              liveFraction={(detectors ?? data.detectors).find(d => d.name === selectedDetector)?.event_fraction}
              modelModified={modelModified}
              setHoveredMechanism={setHoveredMechanism}
              comparisonStats={comparison?.[selectedDetector]}
              mcStats={monteCarlo?.comparison?.[selectedDetector]}
            />
          </div>
        </>
      )}
    </aside>
  );
}
