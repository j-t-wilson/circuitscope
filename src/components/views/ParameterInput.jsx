import { useTheme } from '../../contexts/ThemeContext.jsx';

export default function ParameterInput({ value, originalValue, onChange, gateType }) {
  const { C } = useTheme();
  const maxAllowed = gateType === 'DEPOLARIZE1' ? 0.75 :
                     gateType === 'DEPOLARIZE2' ? 0.9375 : 0.5;
  const maxValue = Math.min(Math.max(originalValue * 2, 0.001), maxAllowed);
  const isModified = Math.abs(value - originalValue) > 1e-12;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="range"
        min={0}
        max={maxValue}
        step={maxValue / 200}
        value={Math.min(value, maxValue)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: 112, cursor: 'pointer', flexShrink: 0 }}
      />
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= 0 && v <= maxAllowed) onChange(v);
        }}
        step="any"
        style={{
          width: 90,
          padding: '5px 7px',
          fontFamily: 'var(--mono)',
          fontSize: 11,
          background: isModified ? C.amberSoft : C.field,
          color: C.text,
          border: `1px solid ${isModified ? C.warning : C.line}`,
          borderRadius: 7,
          textAlign: 'right',
          flexShrink: 0,
        }}
      />
      <button
        onClick={() => onChange(originalValue)}
        disabled={!isModified}
        title="Reset to original"
        style={{
          padding: 0,
          fontSize: 11,
          background: isModified ? C.field : 'transparent',
          color: isModified ? C.textDim : 'transparent',
          border: `1px solid ${isModified ? C.line : 'transparent'}`,
          borderRadius: 7,
          cursor: isModified ? 'pointer' : 'default',
          width: 26,
          height: 26,
          flexShrink: 0,
        }}
      >
        ↺
      </button>
    </div>
  );
}
