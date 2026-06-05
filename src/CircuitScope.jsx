import { useCircuit } from './contexts/CircuitContext.jsx';
import { useTheme } from './contexts/ThemeContext.jsx';
import Header from './components/Header.jsx';
import LoadCircuitModal from './components/LoadCircuitModal.jsx';
import MainPanel from './components/MainPanel.jsx';
import Sidebar from './components/Sidebar.jsx';

export default function CircuitScope() {
  const { C } = useTheme();
  const {
    data,
    selectedDetector, setSelectedDetector,
    hoveredDetector, setHoveredDetector,
    viewMode, setViewMode,
    zoom, setZoom,
    showDetectingRegions, setShowDetectingRegions,
    showLoadModal, setShowLoadModal,
    isLoading,
    loadError,
    relevantErrors,
    highlighted,
    highlightedMeasurements,
    handleLoadCircuit,
    clearLoadError,
    resetToLaunch,
    examples,
    defaultExampleId,
    defaultCircuit,
  } = useCircuit();

  // Show only the launch modal when no data is loaded
  if (!data) {
    return (
      <div className="observatory-shell launch-shell" style={{
        minHeight: '100vh',
        background: `linear-gradient(145deg, ${C.bg}, ${C.bgLight} 48%, ${C.field})`,
        color: C.text,
        fontFamily: "'Avenir Next', 'Inter', 'Segoe UI', system-ui, sans-serif",
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}>
        <LoadCircuitModal
          onClose={() => {}}
          onLoad={handleLoadCircuit}
          isLoading={isLoading}
          error={loadError}
          isLaunchMode={true}
          defaultCircuit={defaultCircuit}
          examples={examples}
          defaultExampleId={defaultExampleId}
        />
      </div>
    );
  }

  return (
    <div className="observatory-shell app-shell" style={{
      height: '100vh',
      background: `linear-gradient(145deg, ${C.bg}, ${C.bgLight} 48%, ${C.field})`,
      color: C.text,
      fontFamily: "'Avenir Next', 'Inter', 'Segoe UI', system-ui, sans-serif",
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box'
    }}>
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        onLoadClick={() => setShowLoadModal(true)}
        onLogoClick={resetToLaunch}
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
        />
        <Sidebar
          data={data}
          selectedDetector={selectedDetector}
          setSelectedDetector={setSelectedDetector}
          relevantErrors={relevantErrors}
          detailedBudgets={data.detailed_budgets}
        />
      </div>

      {showLoadModal && (
        <LoadCircuitModal
          onClose={() => { setShowLoadModal(false); clearLoadError(); }}
          onLoad={handleLoadCircuit}
          isLoading={isLoading}
          error={loadError}
          isLaunchMode={false}
          defaultCircuit={defaultCircuit}
          currentCircuit={data?.circuit_text || ''}
          examples={examples}
          defaultExampleId={defaultExampleId}
        />
      )}
    </div>
  );
}
