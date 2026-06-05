import DetectorPanel from './sidebar/DetectorPanel.jsx';
import ErrorDetails from './sidebar/ErrorDetails.jsx';

export default function Sidebar({ data, selectedDetector, setSelectedDetector, relevantErrors, detailedBudgets }) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      <DetectorPanel
        detectors={data.detectors}
        selectedDetector={selectedDetector}
        setSelectedDetector={setSelectedDetector}
      />
      {selectedDetector && selectedDetector !== 'Average' && (
        <ErrorDetails
          detector={selectedDetector}
          errors={relevantErrors}
          detailedBudget={detailedBudgets?.[selectedDetector]}
        />
      )}
    </aside>
  );
}
