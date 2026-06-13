import { useMemo, useRef, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { GLOBAL_SCALE, sweepCurve, paramsAtSweep, uniformScaleOf } from '../../utils/sweep.js';

// SVG coordinate system (scales to container width via viewBox)
const VB_W = 760;
const VB_H = 230;
const PAD_L = 56;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 30;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

const fmtRate = (v) => (v === 0 ? '0' : v.toPrecision(3));

// Event-fraction curve for one swept parameter (or the global ×k multiplier),
// log x-axis. Hover shows a crosshair readout; clicking the plot writes the
// hovered value through onSetValue (the chart acts as a graphical slider).
export default function SweepChart({ params, sweptName, evaluate, onSetValue }) {
  const { C } = useTheme();
  const svgRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  const isGlobal = sweptName === GLOBAL_SCALE;

  const curve = useMemo(
    () => sweepCurve(params, sweptName, evaluate),
    [params, sweptName, evaluate]
  );

  // Marker positions: nominal (original value / k=1) and current. The current
  // marker only renders when it actually lies on this chart's axis — for the
  // global sweep that means the overrides are a uniform scale of nominal.
  const { nominalX, currentX } = useMemo(() => {
    if (isGlobal) return { nominalX: 1, currentX: uniformScaleOf(params) };
    const p = params.find(q => q.name === sweptName);
    return { nominalX: p?.original_value ?? null, currentX: p?.value ?? null };
  }, [params, sweptName, isGlobal]);

  if (curve.length < 2) return null;

  const xMin = curve[0].x;
  const xMax = curve[curve.length - 1].x;
  const lnMin = Math.log(xMin);
  const lnSpan = Math.log(xMax) - lnMin;
  const xPx = (x) => PAD_L + ((Math.log(x) - lnMin) / lnSpan) * PLOT_W;

  const currentY = currentX != null && currentX >= xMin && currentX <= xMax
    ? evaluate(paramsAtSweep(params, sweptName, currentX))
    : null;
  const yTop = Math.max(
    curve.reduce((m, pt) => Math.max(m, pt.y), 0),
    currentY ?? 0,
    1e-9
  ) * 1.15;
  const yPx = (y) => PAD_T + PLOT_H * (1 - y / yTop);

  // Decade gridlines within the axis range
  const decades = [];
  for (let e = Math.ceil(Math.log10(xMin) - 1e-9); e <= Math.floor(Math.log10(xMax) + 1e-9); e++) {
    decades.push(e);
  }
  const decadeLabel = (e) => (isGlobal ? `×${Math.pow(10, e)}` : `1e${e}`);

  const yTicks = [0.25, 0.5, 0.75, 1].map(f => f * yTop);

  const path = curve
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xPx(pt.x).toFixed(1)},${yPx(pt.y).toFixed(1)}`)
    .join(' ');

  // Map a mouse event to the nearest curve point (points are evenly log-spaced)
  const indexAt = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const px = ((e.clientX - rect.left) / rect.width) * VB_W;
    const frac = (px - PAD_L) / PLOT_W;
    if (frac < -0.02 || frac > 1.02) return null;
    return Math.max(0, Math.min(curve.length - 1, Math.round(frac * (curve.length - 1))));
  };

  const hovered = hoverIdx != null ? curve[hoverIdx] : null;
  const fmtX = (x) => (isGlobal ? `×${fmtRate(x)}` : fmtRate(x));

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
        role="img"
        aria-label={isGlobal ? 'Event fraction vs global noise scale' : `Event fraction vs ${sweptName}`}
        onMouseMove={(e) => setHoverIdx(indexAt(e))}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={(e) => {
          const i = indexAt(e);
          if (i != null) onSetValue(curve[i].x);
        }}
      >
        {/* plot frame */}
        <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} fill={C.fieldAlt} stroke={C.line} />

        {/* decade gridlines + x labels */}
        {decades.map(e => {
          const x = xPx(Math.pow(10, e));
          return (
            <g key={`d${e}`}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + PLOT_H} stroke={C.line} strokeDasharray="3 4" />
              <text x={x} y={VB_H - 12} textAnchor="middle" fontSize={9} fill={C.textFaint} fontFamily="var(--mono)">
                {decadeLabel(e)}
              </text>
            </g>
          );
        })}

        {/* y gridlines + labels (event fraction %) */}
        {yTicks.map((v, i) => (
          <g key={`y${i}`}>
            <line x1={PAD_L} y1={yPx(v)} x2={PAD_L + PLOT_W} y2={yPx(v)} stroke={C.line} strokeDasharray="3 4" />
            <text x={PAD_L - 5} y={yPx(v) + 3} textAnchor="end" fontSize={9} fill={C.textFaint} fontFamily="var(--mono)">
              {(v * 100).toPrecision(3)}%
            </text>
          </g>
        ))}
        <text x={PAD_L - 5} y={yPx(0) + 3} textAnchor="end" fontSize={9} fill={C.textFaint} fontFamily="var(--mono)">
          0%
        </text>

        {/* nominal marker */}
        {nominalX != null && nominalX >= xMin && nominalX <= xMax && (
          <g>
            <line
              x1={xPx(nominalX)} y1={PAD_T} x2={xPx(nominalX)} y2={PAD_T + PLOT_H}
              stroke={C.textDim} strokeDasharray="5 4"
            />
            <text x={xPx(nominalX) + 4} y={PAD_T + 11} fontSize={9} fill={C.textDim} fontFamily="var(--mono)">
              nominal
            </text>
          </g>
        )}

        {/* the curve */}
        <path d={path} fill="none" stroke={C.accent} strokeWidth={2} />

        {/* current-value dot */}
        {currentY != null && (
          <circle cx={xPx(currentX)} cy={yPx(currentY)} r={4.5} fill={C.warning} stroke={C.bg} strokeWidth={1.5} />
        )}

        {/* hover crosshair + readout */}
        {hovered && (
          <g pointerEvents="none">
            <line
              x1={xPx(hovered.x)} y1={PAD_T} x2={xPx(hovered.x)} y2={PAD_T + PLOT_H}
              stroke={C.detectorBright} strokeWidth={1}
            />
            <circle cx={xPx(hovered.x)} cy={yPx(hovered.y)} r={3.5} fill={C.detectorBright} />
            <text
              x={PAD_L + PLOT_W - 8}
              y={PAD_T + 14}
              textAnchor="end"
              fontSize={11}
              fill={C.text}
              fontFamily="var(--mono)"
              fontWeight={700}
            >
              {fmtX(hovered.x)} → {(hovered.y * 100).toFixed(4)}%
            </text>
          </g>
        )}
      </svg>
      <div style={{ marginTop: 6, color: C.textFaint, fontSize: 10, fontFamily: 'var(--mono)' }}>
        {isGlobal
          ? 'event fraction vs all noise rates × k (log axis) — click the curve to scale every parameter'
          : 'event fraction vs parameter value (log axis), other parameters held at current values — click the curve to set the value'}
      </div>
    </div>
  );
}
