import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { useCircuit } from '../../contexts/CircuitContext.jsx';
import { validateCircuit } from '../../utils/validateCircuit.js';

// Shared line metrics so the highlight layer and the transparent textarea
// overlay align exactly
const LINE_H = 24;
const FONT_SIZE = 13;
// Text inset within the content column: line marginLeft -8 + border 3 + padding 9
const TEXT_INSET = 4;
const EDIT_DEBOUNCE_MS = 700;
const MAX_DELTA_CHIPS = 8;

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

function lineColor(line, C) {
  const trimmed = line.trim();
  if (trimmed.startsWith('TICK')) return C.textDim;
  if (line.includes('_ERROR') || line.includes('DEPOLARIZE')) return C.error;
  if (trimmed.startsWith('DETECTOR')) return C.detector;
  if (trimmed.includes('CX')) return C.gate;
  if (trimmed.includes('M')) return C.measure;
  return C.text;
}

function formatPercent(fraction) {
  return `${(fraction * 100).toFixed(2)}%`;
}

// Summary of what the last applied edit changed: clickable chips for changed
// detectors (before → after), plus added/removed detector names.
function DeltaSummary({ deltas, setSelectedDetector }) {
  const { C } = useTheme();
  const { changed, added, removed } = deltas;

  if (!changed.length && !added.length && !removed.length) {
    return <span>re-analyzed — no detector fractions changed</span>;
  }

  const chipStyle = {
    padding: '2px 7px',
    background: C.amberSoft,
    border: `1px solid ${C.detector}`,
    borderRadius: 6,
    color: C.detectorBright,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'var(--mono)',
    whiteSpace: 'nowrap',
  };

  const overflow = changed.length - MAX_DELTA_CHIPS;
  return (
    <>
      {changed.length > 0 && <span>{changed.length} changed:</span>}
      {changed.slice(0, MAX_DELTA_CHIPS).map(({ name, before, after }) => (
        <button
          key={name}
          onClick={() => setSelectedDetector(name)}
          title={`${name}: ${formatPercent(before)} → ${formatPercent(after)} — click to select`}
          style={chipStyle}
        >
          {name} {formatPercent(before)}→{formatPercent(after)}
        </button>
      ))}
      {overflow > 0 && <span>+{overflow} more</span>}
      {added.length > 0 && (
        <span style={{ color: C.success }}>
          +{added.length} added{added.length <= 6 ? ` (${added.join(', ')})` : ''}
        </span>
      )}
      {removed.length > 0 && (
        <span style={{ color: C.error }}>
          −{removed.length} removed{removed.length <= 6 ? ` (${removed.join(', ')})` : ''}
        </span>
      )}
    </>
  );
}

export default function CodeView({ code, selectedDetector }) {
  const { C } = useTheme();
  const { handleLiveEdit, editStatus, editError, fractionDeltas, setSelectedDetector } = useCircuit();

  const [draft, setDraft] = useState(code);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const debounceRef = useRef(null);
  // Last text submitted for analysis, to tell our own round-trips apart from
  // external circuit replacements (noise modal, share links)
  const lastSentRef = useRef(null);
  const liveEditRef = useRef(handleLiveEdit);
  useEffect(() => { liveEditRef.current = handleLiveEdit; });

  // Track the analyzed circuit; the draft is authoritative except when the
  // circuit is replaced from outside the editor.
  useEffect(() => {
    if (code !== draftRef.current && code !== lastSentRef.current) setDraft(code);
  }, [code]);

  // Unmounting (switching views) flushes a pending re-analysis immediately
  // (no-op when the draft matches the analyzed text)
  useEffect(() => () => {
    clearTimeout(debounceRef.current);
    liveEditRef.current(draftRef.current);
  }, []);

  const handleChange = (e) => {
    const text = e.target.value;
    setDraft(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastSentRef.current = text;
      liveEditRef.current(text);
    }, EDIT_DEBOUNCE_MS);
  };

  const lines = useMemo(() => draft.split('\n'), [draft]);

  const dirty = draft !== code;

  const selectedDetectorLines = useMemo(() => {
    if (dirty) return new Set(); // line ↔ detector mapping shifts while typing
    return getSelectedDetectorLineIndexes(lines, selectedDetector);
  }, [lines, selectedDetector, dirty]);

  const warnings = useMemo(() => validateCircuit(draft), [draft]);

  return (
    <div style={{ minWidth: 'max-content' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 10,
        fontSize: 11.5,
        fontFamily: 'var(--mono)',
        color: C.textDim,
        minHeight: 22,
      }}>
        {editStatus === 'analyzing' && <span>analyzing…</span>}
        {editStatus === 'error' && (
          <span style={{ color: C.error }}>{editError} — showing last good analysis</span>
        )}
        {editStatus === 'idle' && dirty && <span>editing…</span>}
        {editStatus === 'idle' && !dirty && fractionDeltas && (
          <DeltaSummary deltas={fractionDeltas} setSelectedDetector={setSelectedDetector} />
        )}
        {editStatus === 'idle' && !dirty && !fractionDeltas && (
          <span>edit the circuit — it re-analyzes as you type</span>
        )}
      </div>
      {warnings.map((warning, i) => (
        <div
          key={i}
          style={{
            color: C.warning,
            fontSize: 11.5,
            marginBottom: 8,
            maxWidth: 720,
            whiteSpace: 'normal',
          }}
        >
          ⚠ {warning.message}
        </div>
      ))}
      <pre style={{
        margin: 0,
        fontSize: FONT_SIZE,
        lineHeight: `${LINE_H}px`,
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
            <div key={i} style={{ height: LINE_H }}>{String(i + 1).padStart(2, '0')}</div>
          ))}
        </div>
        {/* Code content: highlighted lines under a transparent textarea
            overlay (the highlight layer renders the same draft text, so the
            two stay glyph-aligned) */}
        <div style={{ flex: 1, position: 'relative' }}>
          {/* paddingRight gives the overlay textarea slack to type past the
              longest existing line without internal scrolling */}
          <div aria-hidden style={{ paddingRight: 80 }}>
            {lines.map((line, i) => {
              const isSelectedDetector = selectedDetectorLines.has(i);
              return (
                <div
                  key={i}
                  style={{
                    height: LINE_H,
                    padding: '0 9px',
                    background: isSelectedDetector ? C.amberSoft : 'transparent',
                    borderLeft: isSelectedDetector ? `3px solid ${C.detector}` : '3px solid transparent',
                    borderRadius: isSelectedDetector ? 6 : 0,
                    marginLeft: -8,
                  }}
                >
                  <span style={{ color: lineColor(line, C) }}>{line}</span>
                </div>
              );
            })}
          </div>
          <textarea
            value={draft}
            onChange={handleChange}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            aria-label="Stim circuit source"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              margin: 0,
              border: 'none',
              outline: 'none',
              resize: 'none',
              overflow: 'hidden',
              padding: `0 0 0 ${TEXT_INSET}px`,
              background: 'transparent',
              color: 'transparent',
              caretColor: C.text,
              fontFamily: 'inherit',
              fontSize: FONT_SIZE,
              lineHeight: `${LINE_H}px`,
              whiteSpace: 'pre',
            }}
          />
        </div>
      </pre>
    </div>
  );
}
