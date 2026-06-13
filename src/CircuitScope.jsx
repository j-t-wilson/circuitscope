import { useEffect } from 'react';
import { useCircuit } from './contexts/CircuitContext.jsx';
import { useTheme } from './contexts/ThemeContext.jsx';
import Header from './components/Header.jsx';
import LoadCircuitModal from './components/LoadCircuitModal.jsx';
import ImportDataModal from './components/ImportDataModal.jsx';
import NoiseModal from './components/NoiseModal.jsx';
import MainPanel from './components/MainPanel.jsx';
import Sidebar from './components/Sidebar.jsx';

export default function CircuitScope() {
  const { C } = useTheme();
  const {
    data,
    selectedDetector, setSelectedDetector,
    hoveredDetector, setHoveredDetector,
    setHoveredMechanism,
    viewMode, setViewMode,
    zoom, setZoom,
    showDetectingRegions, setShowDetectingRegions,
    showImportModal, setShowImportModal,
    showNoiseModal, setShowNoiseModal,
    showLoadModal,
    isLoading,
    loadError,
    lastCircuit,
    measuredData,
    overrideNotice,
    clearOverrideNotice,
    liveDetectors,
    hasModifiedParams,
    comparison,
    monteCarlo,
    fractionDeltas,
    relevantErrors,
    highlighted,
    highlightedMeasurements,
    propagation,
    toggleErrorPropagation,
    selectPropagationComponent,
    clearPropagation,
    handleLoadCircuit,
    openLoadModal,
    closeLoadModal,
    applyMeasuredData,
    examples,
  } = useCircuit();

  // Keyboard navigation: ←/→ step through detectors in circuit order
  // (Timeline auto-scrolls the selection into view), Esc deselects.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!data || showImportModal || showNoiseModal || showLoadModal) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (e.key === 'Escape') {
        // Dismiss the propagation overlay first, then the detector selection
        if (propagation) clearPropagation();
        else setSelectedDetector(null);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const names = data.detectors.map(d => d.name);
      if (names.length === 0) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const idx = names.indexOf(selectedDetector);
      const next = idx === -1
        ? (dir === 1 ? 0 : names.length - 1)
        : (idx + dir + names.length) % names.length;
      setSelectedDetector(names[next]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [data, showImportModal, showNoiseModal, showLoadModal, selectedDetector, setSelectedDetector, propagation, clearPropagation]);

  // Auto-dismiss the "overrides cleared" notice after a few seconds
  useEffect(() => {
    if (!overrideNotice) return undefined;
    const timer = setTimeout(clearOverrideNotice, 7000);
    return () => clearTimeout(timer);
  }, [overrideNotice, clearOverrideNotice]);

  // Show only the launch modal when no data is loaded
  if (!data) {
    return (
      <div className="observatory-shell launch-shell" style={{
        minHeight: '100vh',
        background: `linear-gradient(145deg, ${C.bg}, ${C.bgLight} 48%, ${C.field})`,
        color: C.text,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}>
        <LoadCircuitModal
          onLoad={handleLoadCircuit}
          isLoading={isLoading}
          error={loadError}
          initialCircuit={lastCircuit}
          examples={examples}
        />
      </div>
    );
  }

  return (
    <div className="observatory-shell app-shell" style={{
      height: '100vh',
      background: `linear-gradient(145deg, ${C.bg}, ${C.bgLight} 48%, ${C.field})`,
      color: C.text,
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box'
    }}>
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        onLogoClick={openLoadModal}
        onImportClick={() => setShowImportModal(true)}
        onNoiseClick={() => setShowNoiseModal(true)}
        hasMeasuredData={!!measuredData}
        circuitText={data.circuit_text}
        selectedDetector={selectedDetector}
      />

      <div className="workspace-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(310px, 360px)',
        gap: 16,
        flex: 1,
        minHeight: 0
      }}>
        <MainPanel
          viewMode={viewMode}
          data={data}
          zoom={zoom}
          setZoom={setZoom}
          selectedDetector={selectedDetector}
          highlighted={highlighted}
          highlightedMeasurements={highlightedMeasurements}
          setSelectedDetector={setSelectedDetector}
          hoveredDetector={hoveredDetector}
          setHoveredDetector={setHoveredDetector}
          showDetectingRegions={showDetectingRegions}
          setShowDetectingRegions={setShowDetectingRegions}
          propagation={propagation}
          toggleErrorPropagation={toggleErrorPropagation}
          selectPropagationComponent={selectPropagationComponent}
          clearPropagation={clearPropagation}
        />
        <Sidebar
          data={data}
          detectors={liveDetectors}
          modelModified={hasModifiedParams}
          selectedDetector={selectedDetector}
          setSelectedDetector={setSelectedDetector}
          setHoveredDetector={setHoveredDetector}
          setHoveredMechanism={setHoveredMechanism}
          relevantErrors={relevantErrors}
          detailedBudgets={data.detailed_budgets}
          comparison={comparison}
          monteCarlo={monteCarlo}
          fractionDeltas={fractionDeltas}
        />
      </div>

      {showNoiseModal && (
        <NoiseModal onClose={() => setShowNoiseModal(false)} />
      )}

      {overrideNotice && (
        <div
          role="status"
          onClick={clearOverrideNotice}
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            maxWidth: 'min(92vw, 560px)',
            padding: '10px 14px',
            background: C.bgLighter,
            color: C.text,
            border: `1px solid ${C.warning}`,
            borderRadius: 8,
            boxShadow: `0 12px 32px rgba(0, 0, 0, 0.35)`,
            fontSize: 12,
            cursor: 'pointer',
          }}
          title="Dismiss"
        >
          <span style={{ color: C.warning, fontWeight: 750 }}>Parameter overrides cleared</span>
          {' — no longer in the circuit: '}
          <span style={{ fontFamily: 'var(--mono)' }}>{overrideNotice.dropped.join(', ')}</span>
        </div>
      )}

      {showLoadModal && (
        <LoadCircuitModal
          onLoad={handleLoadCircuit}
          onCancel={closeLoadModal}
          isLoading={isLoading}
          error={loadError}
          initialCircuit={data.circuit_text}
          examples={examples}
        />
      )}

      {showImportModal && (
        <ImportDataModal
          onClose={() => setShowImportModal(false)}
          onApply={applyMeasuredData}
          onClear={() => applyMeasuredData(null)}
          detectors={data.detectors}
          measuredData={measuredData}
        />
      )}
    </div>
  );
}
