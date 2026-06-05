import { useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';

function getSelectedDetectorLineIndexes(lines, selectedDetector) {
  const match = selectedDetector?.match(/^D(\d+)$/);
  if (!match) return new Set();

  const selectedDetectorId = Number(match[1]);
  const selectedLines = new Set();
  let detectorCount = 0;
  let done = false;

  const walkBlock = (startIndex) => {
    let i = startIndex;
    while (i < lines.length && !done) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith('#')) {
        i += 1;
        continue;
      }

      if (trimmed.startsWith('}')) {
        return i + 1;
      }

      const repeatMatch = trimmed.match(/^REPEAT\s+(\d+)\s*\{/);
      if (repeatMatch) {
        const repeatCount = Number(repeatMatch[1]);
        let afterBlock = i + 1;
        for (let iter = 0; iter < repeatCount && !done; iter += 1) {
          afterBlock = walkBlock(i + 1);
        }
        i = afterBlock;
        continue;
      }

      if (trimmed.startsWith('DETECTOR')) {
        if (detectorCount === selectedDetectorId) {
          selectedLines.add(i);
          done = true;
          return i + 1;
        }
        detectorCount += 1;
      }

      i += 1;
    }
    return i;
  };

  walkBlock(0);
  return selectedLines;
}

export default function CodeView({ code, selectedDetector }) {
  const { C } = useTheme();
  const lines = useMemo(() => code.split('\n'), [code]);

  const selectedDetectorLines = useMemo(() => {
    return getSelectedDetectorLineIndexes(lines, selectedDetector);
  }, [lines, selectedDetector]);

  return (
    <pre style={{
      margin: 0,
      fontSize: 13,
      lineHeight: 1.65,
      display: 'flex',
      background: C.field,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      padding: 14,
      boxShadow: `inset 0 1px 0 ${C.line}`,
      minWidth: 'max-content',
    }}>
      {/* Line number gutter */}
      <div style={{
        userSelect: 'none',
        color: C.textDim,
        textAlign: 'right',
        paddingRight: 16,
        borderRight: `1px solid ${C.line}`,
        marginRight: 16,
        flexShrink: 0
      }}>
        {lines.map((_, i) => (
          <div key={i} style={{ padding: '2px 0' }}>{String(i + 1).padStart(2, '0')}</div>
        ))}
      </div>
      {/* Code content */}
      <div style={{ flex: 1 }}>
        {lines.map((line, i) => {
          const trimmed = line.trim();
          const isSelectedDetector = selectedDetectorLines.has(i);
          const isErr = line.includes('_ERROR') || line.includes('DEPOLARIZE');
          const isDetectorLine = trimmed.startsWith('DETECTOR');
          return (
            <div
              key={i}
              style={{
                padding: '2px 9px',
                background: isSelectedDetector ? C.amberSoft : 'transparent',
                borderLeft: isSelectedDetector ? `3px solid ${C.detector}` : '3px solid transparent',
                borderRadius: isSelectedDetector ? 6 : 0,
                marginLeft: -8,
              }}
            >
              <span style={{
                color: trimmed.startsWith('TICK') ? C.textDim
                  : isErr ? C.error
                  : isDetectorLine ? C.detector
                  : trimmed.includes('CX') ? C.gate
                  : trimmed.includes('M') ? C.measure
                  : C.text
              }}>
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </pre>
  );
}
