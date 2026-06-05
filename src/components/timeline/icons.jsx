// Base size for all single-qubit operations
export const GATE_SIZE = 24;

export function MeterIcon({ cx, cy, color, zoom = 1, basis = 'Z', C }) {
  const s = GATE_SIZE * zoom;
  const half = s / 2;
  const arcOffset = s * 0.29;
  const needleLen = s * 0.21;
  return (
    <g>
      <rect x={cx-half} y={cy-half} width={s} height={s} fill={color} stroke={C.lineStrong} strokeWidth={zoom} rx={5 * zoom} />
      <path d={`M ${cx-arcOffset} ${cy+s*0.17} Q ${cx} ${cy-s*0.25} ${cx+arcOffset} ${cy+s*0.17}`} fill="none" stroke={C.bg} strokeWidth={2 * zoom} />
      <line x1={cx} y1={cy+s*0.17} x2={cx+needleLen} y2={cy-s*0.17} stroke={C.bg} strokeWidth={2 * zoom} />
      {basis !== 'Z' && (
        <text x={cx+half-2*zoom} y={cy+half-1*zoom} fill={C.bg} fontSize={7*zoom} textAnchor="end" dominantBaseline="auto" fontWeight="bold">{basis}</text>
      )}
    </g>
  );
}

export function KetIcon({ cx, cy, zoom = 1, basis = 'Z', C }) {
  const s = GATE_SIZE * zoom;
  const half = s / 2;
  const state = basis === 'X' ? '+' : basis === 'Y' ? '+Y' : '0';
  const fontSize = basis === 'Y' ? 8 : 10;
  const contentOffset = basis === 'Y' ? -1.2 * zoom : 0;
  const barX = cx - (basis === 'Y' ? 8 : 6) * zoom;
  const bracketX = cx + (basis === 'Y' ? 8.5 : 6) * zoom;
  const bracketHalfH = (basis === 'Y' ? 5.6 : 6.2) * zoom;
  const bracketHalfW = 3.2 * zoom;
  const bracketStroke = 1.8 * zoom;
  const textY = cy + 0.2 * zoom;
  return (
    <g>
      <rect x={cx-half} y={cy-half} width={s} height={s} fill={C.qubit} stroke={C.lineStrong} strokeWidth={zoom} rx={5 * zoom} />
      <line
        x1={barX}
        y1={cy - bracketHalfH}
        x2={barX}
        y2={cy + bracketHalfH}
        stroke={C.bg}
        strokeWidth={bracketStroke}
        strokeLinecap="round"
      />
      <text
        x={cx + contentOffset}
        y={textY}
        fill={C.bg}
        fontSize={fontSize * zoom}
        textAnchor="middle"
        dominantBaseline="central"
        fontWeight="bold"
        fontFamily="var(--mono)"
      >
        {state}
      </text>
      <path
        d={`M ${bracketX - bracketHalfW} ${cy - bracketHalfH} L ${bracketX + bracketHalfW} ${cy} L ${bracketX - bracketHalfW} ${cy + bracketHalfH}`}
        fill="none"
        stroke={C.bg}
        strokeWidth={bracketStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}
