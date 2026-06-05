import { useState, useEffect, useRef, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import { GATE_SIZE, MeterIcon, KetIcon } from './icons.jsx';

const TWO_QUBIT_OPS = new Set([
  'CX', 'CZ', 'CY', 'XCX', 'XCZ', 'YCX', 'YCZ',
  'SWAP', 'ISWAP', 'DEPOLARIZE2', 'PAULI_CHANNEL_2'
]);

const TWO_QUBIT_ROLES = {
  CX: ['ctrl', 'tgt'],
  XCX: ['xcx', 'xcx'],
  CZ: ['cz', 'cz'],
  SWAP: ['swap', 'swap'],
  DEPOLARIZE2: ['first', 'second'],
  PAULI_CHANNEL_2: ['first', 'second'],
};

const GENERIC_TWO_QUBIT_GATES = new Set(['ISWAP', 'CY', 'XCZ', 'YCX', 'YCZ']);

// Check if two 2-qubit gates have overlapping vertical spans
function gatesOverlap(gate1, gate2) {
  const [min1, max1] = [Math.min(...gate1), Math.max(...gate1)];
  const [min2, max2] = [Math.min(...gate2), Math.max(...gate2)];
  return !(max1 < min2 || max2 < min1);
}

// Assign sub-columns to gates using greedy graph coloring
function assignSubColumns(gatePairs) {
  const n = gatePairs.length;
  if (n <= 1) return gatePairs.map(() => ({ subColumn: 0, total: 1 }));

  const subColumns = new Array(n).fill(-1);
  const indices = [...Array(n).keys()].sort((a, b) =>
    Math.min(...gatePairs[a]) - Math.min(...gatePairs[b])
  );

  for (const i of indices) {
    const usedColors = new Set();
    for (let j = 0; j < n; j++) {
      if (subColumns[j] >= 0 && gatesOverlap(gatePairs[i], gatePairs[j])) {
        usedColors.add(subColumns[j]);
      }
    }
    let color = 0;
    while (usedColors.has(color)) color++;
    subColumns[i] = color;
  }

  const maxCol = Math.max(...subColumns) + 1;
  return subColumns.map(sc => ({ subColumn: sc, total: maxCol }));
}

// Extract qubit pairs from flat or nested array
function extractQubitPairs(qubits) {
  if (Array.isArray(qubits[0])) return qubits;

  const pairs = [];
  for (let i = 0; i + 1 < qubits.length; i += 2) {
    pairs.push([qubits[i], qubits[i + 1]]);
  }
  return pairs;
}

function getTwoQubitRoles(name) {
  if (TWO_QUBIT_ROLES[name]) return TWO_QUBIT_ROLES[name];
  if (GENERIC_TWO_QUBIT_GATES.has(name)) return ['generic2q', 'generic2q'];
  return null;
}

function pushMappedOp(map, key, op) {
  if (!map[key]) map[key] = [];
  map[key].push(op);
}

function mapTwoQubitPair(map, tick, order, op, pair, roles, subColInfo) {
  const [q1, q2] = pair;
  const pairMeta = {
    ...op,
    subColumn: subColInfo.subColumn,
    totalSubColumns: subColInfo.total,
  };

  if (op.name === 'DEPOLARIZE2' || op.name === 'PAULI_CHANNEL_2') {
    pairMeta.pairQubits = [q1, q2];
  }

  pushMappedOp(map, `${tick}-${q1}-${order}`, { ...pairMeta, role: roles[0], partner: q2 });
  pushMappedOp(map, `${tick}-${q2}-${order}`, { ...pairMeta, role: roles[1], partner: q1 });
}

export default function Timeline({
  data,
  zoom,
  selectedDetector,
  highlighted,
  highlightedMeasurements,
  setSelectedDetector,
  hoveredDetector,
  setHoveredDetector,
  showDetectingRegions
}) {
  const { C } = useTheme();
  const [animatingDetectors, setAnimatingDetectors] = useState(new Set());
  const prevSelectedRef = useRef(null);

  useEffect(() => {
    if (selectedDetector && selectedDetector !== prevSelectedRef.current) {
      setAnimatingDetectors(prev => new Set(prev).add(selectedDetector));
      const timer = setTimeout(() => {
        setAnimatingDetectors(prev => {
          const next = new Set(prev);
          next.delete(selectedDetector);
          return next;
        });
      }, 400);
      return () => clearTimeout(timer);
    }
    prevSelectedRef.current = selectedDetector;
  }, [selectedDetector]);

  // Scaled dimensions
  const gateSize = GATE_SIZE * zoom;
  const gateHalf = gateSize / 2;
  const strokeW = 2 * zoom;
  const detectorPadding = 55 * zoom;

  // Calculate max orders per tick
  const tickInfo = useMemo(() => {
    return data.timeline.map(t => {
      const orders = t.ops.map(op => op.order ?? 0);
      const maxOrder = orders.length > 0 ? Math.max(...orders) : 0;
      return { maxOrder, numSlots: maxOrder + 1 };
    });
  }, [data.timeline]);

  // Ticks with detectors
  const ticksWithDetectors = useMemo(() => {
    const ticks = new Set();
    data.detectors.forEach(d => ticks.add(d.tick));
    return ticks;
  }, [data.detectors]);

  const baseW = 80 * zoom;
  const subSlotW = 55 * zoom;
  const H = 50 * zoom;

  // Cumulative x positions for each tick
  const tickXPositions = useMemo(() => {
    const positions = [60 * zoom];
    tickInfo.forEach((info, i) => {
      let tickWidth = Math.max(baseW, info.numSlots * subSlotW);
      if (ticksWithDetectors.has(i)) tickWidth += detectorPadding;
      positions.push(positions[i] + tickWidth);
    });
    return positions;
  }, [tickInfo, baseW, subSlotW, ticksWithDetectors, detectorPadding, zoom]);

  const totalWidth = tickXPositions[tickXPositions.length - 1];

  // Sub-column assignments for overlapping 2-qubit gates
  const tickSubColumnInfo = useMemo(() => {
    return data.timeline.map((t, ti) => {
      const twoQubitByOrder = {};

      t.ops.forEach((op, opIdx) => {
        const order = op.order ?? 0;
        if (TWO_QUBIT_OPS.has(op.name)) {
          if (!twoQubitByOrder[order]) twoQubitByOrder[order] = [];
          const pairs = extractQubitPairs(op.qubits);
          pairs.forEach((pair, pairIdx) => {
            twoQubitByOrder[order].push({ pair, opIdx, pairIdx });
          });
        }
      });

      const subColumnMap = {};
      let maxSubColumns = 1;

      for (const entries of Object.values(twoQubitByOrder)) {
        const assignments = assignSubColumns(entries.map(e => e.pair));
        entries.forEach((e, i) => {
          subColumnMap[`${e.opIdx}-${e.pairIdx}`] = assignments[i];
          maxSubColumns = Math.max(maxSubColumns, assignments[i].total);
        });
      }

      return { subColumnMap, maxSubColumns, needsGroupingLine: maxSubColumns > 1 };
    });
  }, [data.timeline]);

  // Build operation map
  const opMap = useMemo(() => {
    const m = {};
    data.timeline.forEach((t, ti) => {
      const tickSubCol = tickSubColumnInfo[ti];
      t.ops.forEach((op, opIdx) => {
        const order = op.order ?? 0;

        const roles = getTwoQubitRoles(op.name);
        if (roles) {
          extractQubitPairs(op.qubits).forEach((pair, pairIdx) => {
            const subColInfo = tickSubCol.subColumnMap[`${opIdx}-${pairIdx}`] || { subColumn: 0, total: 1 };
            mapTwoQubitPair(m, ti, order, op, pair, roles, subColInfo);
          });
          return;
        }

        const qubits = Array.isArray(op.qubits[0]) ? op.qubits.flat() : op.qubits;
        qubits.forEach(q => pushMappedOp(m, `${ti}-${q}-${order}`, op));
      });
    });
    return m;
  }, [data.timeline, tickSubColumnInfo]);

  const isHi = (ti, q, n, rate) => highlighted.has(`${ti}-${q}-${n}-${rate}`);

  const detectorExtraWidth = 50 * zoom;
  const svgWidth = totalWidth + 60 * zoom + detectorExtraWidth;
  const svgHeight = H * (data.num_qubits + 1) + 60 * zoom;

  const getX = (ti, order, subColumn = 0, totalSubColumns = 1) => {
    const tickStart = tickXPositions[ti];
    const tickEnd = tickXPositions[ti + 1];
    const tickWidthTotal = tickEnd - tickStart;
    const detPad = ticksWithDetectors.has(ti) ? detectorPadding : 0;
    const tickWidthForOps = tickWidthTotal - detPad;
    const numSlots = tickInfo[ti].numSlots;
    const slotWidth = tickWidthForOps / numSlots;
    const slotCenter = tickStart + slotWidth * order + slotWidth / 2;

    if (totalSubColumns <= 1) return slotCenter;

    const subSlotSpacing = Math.min(subSlotW * 0.5, slotWidth * 0.8 / totalSubColumns);
    const offset = (subColumn - (totalSubColumns - 1) / 2) * subSlotSpacing;
    return slotCenter + offset;
  };

  return (
    <div
      className="soft-scroll"
      style={{
        overflowX: 'auto',
        background: C.field,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        padding: 12,
        boxShadow: `inset 0 1px 0 ${C.line}`,
      }}
    >
      <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
        <defs>
          <pattern id="timelineGrid" width={42 * zoom} height={42 * zoom} patternUnits="userSpaceOnUse">
            <path d={`M ${42 * zoom} 0 L 0 0 0 ${42 * zoom}`} fill="none" stroke={C.line} strokeWidth={0.8 * zoom} />
          </pattern>
          <linearGradient id="gateFace" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.gate} />
            <stop offset="100%" stopColor={C.accentDim} />
          </linearGradient>
          <linearGradient id="errorFace" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.error} />
            <stop offset="100%" stopColor={C.errorDim} />
          </linearGradient>
          <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <linearGradient id="eyeFlourishGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.accent} />
            <stop offset="55%" stopColor={C.detectorBright} />
            <stop offset="100%" stopColor={C.observable} />
          </linearGradient>
          <filter id="eyeFlourishGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <style>{`
          @keyframes eyeFlourishExpand {
            0% { transform: scale(0.45); opacity: 0; }
            35% { transform: scale(1.05); opacity: 0.9; }
            100% { transform: scale(1.36); opacity: 0; }
          }
          .detector-eye-flourish {
            animation: eyeFlourishExpand 360ms ease-out forwards;
            pointer-events: none;
          }
        `}</style>

        <rect x={0} y={0} width={svgWidth} height={svgHeight} fill="url(#timelineGrid)" opacity={0.58} />

        {/* Grouping lines for parallel 2-qubit gates */}
        {tickSubColumnInfo.map((info, ti) => {
          if (!info.needsGroupingLine) return null;
          const yGroup = 50 * zoom;
          const xFirst = getX(ti, 0, 0, info.maxSubColumns);
          const xLast = getX(ti, 0, info.maxSubColumns - 1, info.maxSubColumns);
          return (
            <g key={`group-${ti}`}>
              <line x1={xFirst} y1={yGroup} x2={xLast} y2={yGroup} stroke={C.lineWarm} strokeWidth={strokeW} />
              {Array.from({ length: info.maxSubColumns }).map((_, sc) => (
                <line key={sc}
                      x1={getX(ti, 0, sc, info.maxSubColumns)} y1={yGroup - 4 * zoom}
                      x2={getX(ti, 0, sc, info.maxSubColumns)} y2={yGroup + 4 * zoom}
                      stroke={C.detector} strokeWidth={strokeW} />
              ))}
            </g>
          );
        })}

        {/* Qubit labels and lines */}
        {Array.from({ length: data.num_qubits }).map((_, i) => (
          <g key={i}>
            <rect
              x={12 * zoom}
              y={60 * zoom + i * H + H / 2 - 12 * zoom}
              width={36 * zoom}
              height={24 * zoom}
              rx={6 * zoom}
              fill={C.glassStrong}
              stroke={C.line}
              strokeWidth={zoom}
            />
            <text x={30 * zoom} y={60 * zoom + i * H + H / 2} fill={C.textDim} fontSize={12 * zoom} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--mono)">q{i}</text>
            <line x1={60 * zoom} y1={60 * zoom + i * H + H / 2} x2={totalWidth} y2={60 * zoom + i * H + H / 2} stroke={C.lineStrong} strokeWidth={strokeW * 1.6} opacity={0.45} />
            <line x1={60 * zoom} y1={60 * zoom + i * H + H / 2} x2={totalWidth} y2={60 * zoom + i * H + H / 2} stroke={C.qubit} strokeWidth={strokeW} opacity={0.34} strokeLinecap="round" />
          </g>
        ))}

        {/* Detecting Regions overlay */}
        {showDetectingRegions && selectedDetector && data.detecting_regions?.[selectedDetector] && (() => {
          const regions = data.detecting_regions[selectedDetector];
          const detectorInfo = data.detectors.find(d => d.name === selectedDetector);
          const detectorTick = detectorInfo?.tick;

          const renderRegions = (qubits, color, keyPrefix, tick) => {
            if (qubits.length === 0) return null;
            const x1 = tickXPositions[tick];
            const isDetectorTick = tick === detectorTick;
            let x2;
            if (isDetectorTick) {
              const tickEnd = tickXPositions[tick + 1] - (ticksWithDetectors.has(tick) ? detectorPadding : 0);
              x2 = (tickXPositions[tick] + tickEnd) / 2 + 10 * zoom;
            } else {
              x2 = tickXPositions[tick + 1];
            }
            const width = x2 - x1;
            return qubits.map(q => {
              const y1 = 60 * zoom + q * H + H * 0.15;
              const y2 = 60 * zoom + q * H + H * 0.85;
              return (
                <rect
                  key={`${keyPrefix}-q${q}`}
                  x={x1}
                  y={y1}
                  width={width}
                  height={y2 - y1}
                  fill={color}
                  opacity={0.22}
                  stroke={color}
                  strokeOpacity={0.42}
                  strokeWidth={zoom}
                  rx={4 * zoom}
                />
              );
            });
          };

          return (
            <g className="detecting-regions">
              {Object.entries(regions).map(([tickStr, sensitivities]) => {
                const tick = parseInt(tickStr);
                if (tick >= tickXPositions.length - 1) return null;

                const xQubits = sensitivities.filter(s => s.pauli === 'X').map(s => s.qubit);
                const zQubits = sensitivities.filter(s => s.pauli === 'Z').map(s => s.qubit);

                return (
                  <g key={`region-${tick}`}>
                    {renderRegions(zQubits, C.qubit, `z-${tick}`, tick)}
                    {renderRegions(xQubits, C.error, `x-${tick}`, tick)}
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Tick labels */}
        {data.timeline.map((t, ti) => {
          const tickCenter = (tickXPositions[ti] + tickXPositions[ti + 1]) / 2;
          return (
            <g key={ti}>
              <line
                x1={tickXPositions[ti]}
                y1={52 * zoom}
                x2={tickXPositions[ti]}
                y2={svgHeight - 12 * zoom}
                stroke={C.line}
                strokeWidth={zoom}
                strokeDasharray={`${2 * zoom},${6 * zoom}`}
              />
              <text x={tickCenter} y={38 * zoom} fill={C.textDim} fontSize={11 * zoom} textAnchor="middle" fontFamily="var(--mono)">t={ti}</text>
            </g>
          );
        })}

        {/* Render operations */}
        {data.timeline.map((t, ti) => (
          <g key={ti}>
            {Array.from({ length: data.num_qubits }).map((_, qi) => {
              const ordersWithOps = [];
              for (let order = 0; order <= tickInfo[ti].maxOrder; order++) {
                const ops = opMap[`${ti}-${qi}-${order}`];
                if (ops && ops.length > 0) {
                  ordersWithOps.push({ order, ops });
                }
              }
              if (ordersWithOps.length === 0) return null;

              return (
                <g key={`${ti}-${qi}`}>
                  {ordersWithOps.map(({ order, ops }) => {
                    const x = getX(ti, order);
                    const y = 60 * zoom + qi * H + H / 2;

                    return ops.map((op, oi) => {
                      const hi = isHi(ti, qi, op.name, op.rate);
                      const f = hi ? 'url(#glow)' : undefined;

                      const triH = 10 * zoom;
                      const triW = 8 * zoom;
                      const cxCtrlR = 6 * zoom;
                      const cxTgtR = 11 * zoom;

                      if (op.name === 'CX') {
                        const cxX = getX(ti, order, op.subColumn ?? 0, op.totalSubColumns ?? 1);
                        if (op.role === 'ctrl') return (
                          <g key={`gate-${order}-${oi}-${op.subColumn ?? 0}`}>
                            <line x1={cxX} y1={y} x2={cxX} y2={60 * zoom + op.partner * H + H / 2} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} filter={f} />
                            <circle cx={cxX} cy={y} r={cxCtrlR} fill={hi ? C.error : C.gate} filter={f} />
                          </g>
                        );
                        return (
                          <g key={`gate-${order}-${oi}-${op.subColumn ?? 0}`} filter={f}>
                            <circle cx={cxX} cy={y} r={cxTgtR} fill="none" stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                            <line x1={cxX-cxTgtR} y1={y} x2={cxX+cxTgtR} y2={y} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                            <line x1={cxX} y1={y-cxTgtR} x2={cxX} y2={y+cxTgtR} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                          </g>
                        );
                      }

                      if (op.name === 'XCX') {
                        const xcxX = getX(ti, order, op.subColumn ?? 0, op.totalSubColumns ?? 1);
                        const partnerY = 60 * zoom + op.partner * H + H / 2;
                        const shouldDrawLine = qi < op.partner;
                        return (
                          <g key={`xcx-${order}-${oi}-${op.subColumn ?? 0}`} filter={f}>
                            {shouldDrawLine && <line x1={xcxX} y1={y} x2={xcxX} y2={partnerY} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />}
                            <circle cx={xcxX} cy={y} r={cxTgtR} fill="none" stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                            <line x1={xcxX-cxTgtR} y1={y} x2={xcxX+cxTgtR} y2={y} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                            <line x1={xcxX} y1={y-cxTgtR} x2={xcxX} y2={y+cxTgtR} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                          </g>
                        );
                      }

                      if (op.name === 'CZ') {
                        const czX = getX(ti, order, op.subColumn ?? 0, op.totalSubColumns ?? 1);
                        const partnerY = 60 * zoom + op.partner * H + H / 2;
                        const shouldDrawLine = qi < op.partner;
                        return (
                          <g key={`cz-${order}-${oi}-${op.subColumn ?? 0}`} filter={f}>
                            {shouldDrawLine && <line x1={czX} y1={y} x2={czX} y2={partnerY} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />}
                            <circle cx={czX} cy={y} r={cxCtrlR} fill={hi ? C.error : C.gate} />
                          </g>
                        );
                      }

                      if (op.name === 'SWAP') {
                        const swapX = getX(ti, order, op.subColumn ?? 0, op.totalSubColumns ?? 1);
                        const partnerY = 60 * zoom + op.partner * H + H / 2;
                        const shouldDrawLine = qi < op.partner;
                        const swapSize = 8 * zoom;
                        return (
                          <g key={`swap-${order}-${oi}-${op.subColumn ?? 0}`} filter={f}>
                            {shouldDrawLine && <line x1={swapX} y1={y} x2={swapX} y2={partnerY} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />}
                            <line x1={swapX-swapSize} y1={y-swapSize} x2={swapX+swapSize} y2={y+swapSize} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                            <line x1={swapX-swapSize} y1={y+swapSize} x2={swapX+swapSize} y2={y-swapSize} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />
                          </g>
                        );
                      }

                      if (op.role === 'generic2q') {
                        const gateX = getX(ti, order, op.subColumn ?? 0, op.totalSubColumns ?? 1);
                        const partnerY = 60 * zoom + op.partner * H + H / 2;
                        const shouldDrawLine = qi < op.partner;
                        return (
                          <g key={`generic2q-${order}-${oi}-${op.subColumn ?? 0}`} filter={f}>
                            {shouldDrawLine && <line x1={gateX} y1={y} x2={gateX} y2={partnerY} stroke={hi ? C.error : C.gate} strokeWidth={strokeW} />}
                            <rect x={gateX-gateHalf} y={y-gateHalf} width={gateSize} height={gateSize} fill={hi ? 'url(#errorFace)' : 'url(#gateFace)'} stroke={hi ? C.error : C.lineStrong} strokeWidth={zoom} rx={5 * zoom} />
                            <text x={gateX} y={y+1*zoom} fill={C.bg} fontSize={12*zoom} textAnchor="middle" dominantBaseline="middle" fontWeight="bold" fontFamily="var(--mono)">{op.name}</text>
                          </g>
                        );
                      }

                      if (op.name === 'DEPOLARIZE2' || op.name === 'PAULI_CHANNEL_2') {
                        const errX = getX(ti, order, op.subColumn ?? 0, op.totalSubColumns ?? 1);
                        const partnerY = 60 * zoom + op.partner * H + H / 2;
                        if (op.role === 'first') {
                          return (
                            <g key={`err2-${order}-${oi}-${op.subColumn ?? 0}`} filter={f}>
                              <line x1={errX} y1={y} x2={errX} y2={partnerY} stroke={hi ? C.error : C.errorDim} strokeWidth={strokeW} strokeDasharray={`${4*zoom},${2*zoom}`} />
                              <polygon points={`${errX},${y-triH} ${errX+triW},${y+triH*0.6} ${errX-triW},${y+triH*0.6}`} fill={hi ? 'url(#errorFace)' : C.errorDim} stroke={hi ? C.error : C.lineStrong} strokeWidth={zoom} />
                              <text x={errX} y={y+zoom} fill={C.bg} fontSize={8*zoom} textAnchor="middle" dominantBaseline="middle" fontWeight="bold" fontFamily="var(--mono)">!</text>
                            </g>
                          );
                        }
                        return (
                          <g key={`err2-${order}-${oi}-${op.subColumn ?? 0}`} filter={f}>
                            <polygon points={`${errX},${y-triH} ${errX+triW},${y+triH*0.6} ${errX-triW},${y+triH*0.6}`} fill={hi ? 'url(#errorFace)' : C.errorDim} stroke={hi ? C.error : C.lineStrong} strokeWidth={zoom} />
                            <text x={errX} y={y+zoom} fill={C.bg} fontSize={8*zoom} textAnchor="middle" dominantBaseline="middle" fontWeight="bold" fontFamily="var(--mono)">!</text>
                          </g>
                        );
                      }

                      if (op.type === 'error') {
                        return (
                          <g key={`err-${order}-${oi}`} filter={f}>
                            <polygon points={`${x},${y-triH} ${x+triW},${y+triH*0.6} ${x-triW},${y+triH*0.6}`} fill={hi ? 'url(#errorFace)' : C.errorDim} stroke={hi ? C.error : C.lineStrong} strokeWidth={zoom} />
                            <text x={x} y={y+zoom} fill={C.bg} fontSize={8*zoom} textAnchor="middle" dominantBaseline="middle" fontWeight="bold" fontFamily="var(--mono)">!</text>
                          </g>
                        );
                      }

                      if (op.type === 'measure') {
                        const isMeasHighlighted = highlightedMeasurements.has(`${ti}-${qi}`);
                        const measColor = hi ? C.error : (isMeasHighlighted ? C.detectorBright : C.measure);
                        const measFilter = hi ? f : (isMeasHighlighted ? 'url(#glow)' : undefined);
                        const measBasis = op.name.includes('X') ? 'X' : op.name.includes('Y') ? 'Y' : 'Z';
                        const isMR = op.name.startsWith('MR');
                        if (isMR) {
                          const offset = gateHalf + 2 * zoom;
                          return (
                            <g key={`meas-${order}-${oi}`} filter={measFilter}>
                              <MeterIcon cx={x - offset} cy={y} color={measColor} zoom={zoom} basis={measBasis} C={C} />
                              <KetIcon cx={x + offset} cy={y} zoom={zoom} basis={measBasis} C={C} />
                            </g>
                          );
                        }
                        return (
                          <g key={`meas-${order}-${oi}`} filter={measFilter}>
                            <MeterIcon cx={x} cy={y} color={measColor} zoom={zoom} basis={measBasis} C={C} />
                          </g>
                        );
                      }

                      if (op.type === 'init') {
                        const initBasis = op.name === 'RX' ? 'X' : op.name === 'RY' ? 'Y' : 'Z';
                        return (
                          <g key={`init-${order}-${oi}`}>
                            <KetIcon cx={x} cy={y} zoom={zoom} basis={initBasis} C={C} />
                          </g>
                        );
                      }

                      if (op.type === 'gate') return (
                        <g key={`gate-${order}-${oi}`} filter={f}>
                          <rect x={x-gateHalf} y={y-gateHalf} width={gateSize} height={gateSize} fill={hi ? 'url(#errorFace)' : 'url(#gateFace)'} stroke={hi ? C.error : C.lineStrong} strokeWidth={zoom} rx={5 * zoom} />
                          <text x={x} y={y+1*zoom} fill={C.bg} fontSize={12*zoom} textAnchor="middle" dominantBaseline="middle" fontWeight="bold" fontFamily="var(--mono)">{op.name}</text>
                        </g>
                      );

                      return null;
                    });
                  })}
                </g>
              );
            })}
          </g>
        ))}

        {/* Render detectors */}
        {data.detectors.map(d => {
          const detTick = d.tick;
          const qubitIdx = d.qubit;
          const tickEnd = tickXPositions[Math.min(detTick + 1, tickXPositions.length - 1)] - (ticksWithDetectors.has(detTick) ? detectorPadding : 0);
          const baseX = tickEnd + detectorPadding / 2;
          const y = 60 * zoom + qubitIdx * H + H / 2;
          const sel = selectedDetector === d.name;
          const hov = hoveredDetector === d.name;
          const expanded = sel || hov;
          const radius = (sel ? 13 : (hov ? 11 : 6)) * zoom;
          const innerRadius = (sel ? 4.4 : (hov ? 3.8 : 2.4)) * zoom;
          const isAnimating = animatingDetectors.has(d.name);
          const labelWidth = Math.max(30, d.name.length * 8 + 12) * zoom;

          return (
            <g
              key={d.name}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedDetector(sel ? null : d.name)}
              onMouseEnter={() => setHoveredDetector(d.name)}
              onMouseLeave={() => setHoveredDetector(null)}
            >
              {isAnimating && (
                <g className="detector-eye-flourish" style={{ transformOrigin: `${baseX}px ${y}px` }}>
                  <circle cx={baseX} cy={y} r={18 * zoom} fill="none" stroke="url(#eyeFlourishGradient)" strokeWidth={2 * zoom} />
                  {[0, 60, 120, 180, 240, 300].map(angle => {
                    const rad = (angle * Math.PI) / 180;
                    const innerR = 10 * zoom;
                    const outerR = 22 * zoom;
                    return (
                      <line
                        key={angle}
                        x1={baseX + Math.cos(rad) * innerR}
                        y1={y + Math.sin(rad) * innerR}
                        x2={baseX + Math.cos(rad) * outerR}
                        y2={y + Math.sin(rad) * outerR}
                        stroke="url(#eyeFlourishGradient)"
                        strokeWidth={2 * zoom}
                        strokeLinecap="round"
                        filter="url(#eyeFlourishGlow)"
                      />
                    );
                  })}
                </g>
              )}
              <circle
                cx={baseX}
                cy={y}
                r={radius}
                fill={sel ? C.amberSoft : (hov ? C.glassStrong : C.fieldAlt)}
                stroke={sel ? C.detectorBright : (hov ? C.detector : C.lineStrong)}
                strokeWidth={sel ? strokeW : zoom}
                filter={sel ? 'url(#glow)' : undefined}
                style={{ transition: 'all 150ms ease-out' }}
              />
              <circle
                cx={baseX}
                cy={y}
                r={radius * 0.62}
                fill="none"
                stroke={sel ? C.detectorBright : C.textDim}
                strokeWidth={zoom}
                opacity={sel || hov ? 0.8 : 0.45}
              />
              <line
                x1={baseX - radius * 0.48}
                y1={y}
                x2={baseX + radius * 0.48}
                y2={y}
                stroke={sel ? C.detectorBright : C.textDim}
                strokeWidth={zoom}
                opacity={sel || hov ? 0.9 : 0.4}
              />
              <circle
                cx={baseX}
                cy={y}
                r={innerRadius}
                fill={sel ? C.detectorBright : (hov ? C.detector : C.textDim)}
              />
              {expanded && (
                <g>
                  <rect
                    x={baseX + 14 * zoom}
                    y={y - 11 * zoom}
                    width={labelWidth}
                    height={22 * zoom}
                    rx={6 * zoom}
                    fill={C.glassStrong}
                    stroke={sel ? C.detector : C.line}
                    strokeWidth={zoom}
                  />
                  <text
                    x={baseX + 14 * zoom + labelWidth / 2}
                    y={y + zoom}
                    fill={sel ? C.detectorBright : C.text}
                    fontSize={10 * zoom}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontWeight="bold"
                    fontFamily="var(--mono)"
                  >
                    {d.name}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
