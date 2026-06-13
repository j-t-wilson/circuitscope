import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { downloadTable } from '../utils/exportTable.js';

// Small download button that opens a CSV/JSON format menu (same interaction
// pattern as the timeline image-export menu). `getTable` is called at click
// time and must return {columns, rows} for exportTable.downloadTable.
export default function ExportMenu({ baseName, getTable, title = 'Export this table for offline analysis' }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleExport = (format) => {
    const { columns, rows } = getTable();
    downloadTable(format, baseName, columns, rows);
    setOpen(false);
  };

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        style={{
          padding: '3px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: open ? C.amberSoft : C.field,
          color: open ? C.detectorBright : C.textDim,
          border: `1px solid ${open ? C.detector : C.line}`,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 700,
          fontFamily: 'var(--mono)',
          transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        export
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 150,
            padding: 5,
            background: C.bgLighter || C.field,
            border: `1px solid ${C.line}`,
            borderRadius: 9,
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
            gap: 3,
          }}
        >
          <div style={{ padding: '3px 9px 4px', fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: C.textDim, fontFamily: 'var(--display)' }}>
            Export table as
          </div>
          {[
            ['csv', 'CSV', 'Comma-separated, one row per entry'],
            ['json', 'JSON', 'Array of row objects'],
          ].map(([format, label, hint]) => (
            <button
              key={format}
              role="menuitem"
              onClick={() => handleExport(format)}
              title={hint}
              style={{
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                padding: '6px 9px',
                borderRadius: 7,
                cursor: 'pointer',
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
  );
}
