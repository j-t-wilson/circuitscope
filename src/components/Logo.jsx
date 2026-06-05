import { useId } from 'react';
import { useTheme } from '../contexts/ThemeContext.jsx';

export default function Logo({ size = 40 }) {
  const { C } = useTheme();
  const id = useId().replace(/:/g, '');
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={`logoLens-${id}`} x1="16%" y1="10%" x2="86%" y2="92%">
          <stop offset="0%" stopColor={C.accent} />
          <stop offset="58%" stopColor={C.detectorBright} />
          <stop offset="100%" stopColor={C.observable} />
        </linearGradient>
        <filter id={`logoGlow-${id}`} x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="1.35" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle
        cx={center}
        cy={center}
        r={size * 0.43}
        fill={C.glass}
        stroke={C.lineStrong}
        strokeWidth={size * 0.025}
      />
      <circle
        cx={center}
        cy={center}
        r={size * 0.31}
        fill="none"
        stroke={`url(#logoLens-${id})`}
        strokeWidth={size * 0.025}
        opacity={0.9}
        filter={`url(#logoGlow-${id})`}
      />
      <ellipse
        cx={center}
        cy={center}
        rx={size * 0.28}
        ry={size * 0.105}
        fill="none"
        stroke={C.detector}
        strokeWidth={size * 0.018}
        opacity={0.72}
      />
      <ellipse
        cx={center}
        cy={center}
        rx={size * 0.105}
        ry={size * 0.28}
        fill="none"
        stroke={C.accent}
        strokeWidth={size * 0.018}
        opacity={0.58}
      />
      <path
        d={`M ${center - size * 0.39} ${center} H ${center - size * 0.18} M ${center + size * 0.18} ${center} H ${center + size * 0.39} M ${center} ${center - size * 0.39} V ${center - size * 0.18} M ${center} ${center + size * 0.18} V ${center + size * 0.39}`}
        stroke={C.textDim}
        strokeWidth={size * 0.014}
        strokeLinecap="round"
        opacity={0.6}
      />
      <circle
        cx={center}
        cy={center}
        r={size * 0.083}
        fill={C.bg}
        stroke={C.detectorBright}
        strokeWidth={size * 0.025}
      />
    </svg>
  );
}
