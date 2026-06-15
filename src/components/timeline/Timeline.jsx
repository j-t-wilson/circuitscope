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
  svgRef,
  zoom,
  selectedDetector,
  highlighted,
  highlightedMeasurements,
  setSelectedDetector,
  hoveredDetector,
  setHoveredDetector,
  showDetectingRegions,
  propagation,
  onErrorToggle
}) {
  const { C } = useTheme();
  const [animatingDetectors, setAnimatingDetectors] = useState(new Set());
  const [tooltip, setTooltip] = useState(null);
  const prevSelectedRef = useRef(null);
  const containerRef = useRef(null);
  const labelLayerRef = useRef(null);
  const tickLabelLayerRef = useRef(null);
  const selectedDetectorRef = useRef(null);

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

  // Bring the selected detector into view (e.g. when picked from the sidebar)
  // unless its marker is already fully visible.
  useEffect(() => {
    const node = selectedDetectorRef.current;
    const cont = containerRef.current;
    if (!selectedDetector || !node || !cont) return;
    const nb = node.getBoundingClientRect();
    const cb = cont.getBoundingClientRect();
    const horizVisible = nb.left >= cb.left && nb.right <= cb.right;
    const vertVisible = nb.top >= 0 && nb.bottom <= window.innerHeight;
    if (!horizVisible || !vertVisible) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedDetector]);

  // Keep qubit labels pinned while the timeline scrolls horizontally
  const handleScroll = (e) => {
    labelLayerRef.current?.setAttribute('transform', `translate(${e.currentTarget.scrollLeft}, 0)`);
  };

  const showTip = (e, tip) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, ...tip });
  };
  const hideTip = () => setTooltip(null);

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

  const isHi = (ti, q, op) => {
    const idx = op.instruction_index;
    if (idx != null && idx >= 0 && highlighted.has(`i${idx}-${q}`)) return true;
    return highlighted.has(`${ti}-${q}-${op.name}-${op.rate}`);
  };

  // Error propagation overlay: measurement keys flipped by the propagated
  // Pauli, and the set of detectors it flips (rings on their markers).
  const propFlippedMeas = useMemo(() => {
    const s = new Set();
    (propagation?.flippedMeasurements || []).forEach(idx => {
      const meas = data.measurements[idx];
      if (meas) s.add(`${meas.tick}-${meas.qubit}`);
    });
    return s;
  }, [propagation, data.measurements]);

  const propFlippedDetectors = useMemo(
    () => new Set(propagation?.flippedDetectors || []),
    [propagation]
  );

  const isPropagationSource = (ti, op, qubitsForOp) =>
    propagation
    && propagation.source.tick === ti
    && propagation.source.name === op.name
    && qubitsForOp.length === propagation.source.qubits.length
    && qubitsForOp.every(q => propagation.source.qubits.includes(q));

  // Error channels toggle the propagation overlay on click
  const errorClickProps = (ti, op, qubitsForOp) => ({
    onClick: (e) => {
      e.stopPropagation();
      onErrorToggle?.({ tick: ti, name: op.name, rate: op.rate, qubits: qubitsForOp });
    },
    style: { cursor: 'pointer' },
  });

  const detectorExtraWidth = 50 * zoom;
  const svgWidth = totalWidth + 60 * zoom + detectorExtraWidth;
  const svgHeight = H * (data.num_qubits + 1) + 60 * zoom;

  // Keep the t=N row pinned while the view scrolls vertically. Vertical
  // scrolling happens in the MainPanel content area (an ancestor), not this
  // component's own container (horizontal only), so counter-translate the
  // tick-label layer by how far the svg top has scrolled past the ancestor's
  // visible top.
  useEffect(() => {
    const scroller = containerRef.current?.parentElement?.closest('.soft-scroll');
    const svg = svgRef.current;
    if (!scroller || !svg) return undefined;
    const stripH = 44 * zoom;
    const update = () => {
      const dy = scroller.getBoundingClientRect().top - svg.getBoundingClientRect().top;
      const pinned = Math.min(Math.max(dy, 0), Math.max(svgHeight - stripH, 0));
      tickLabelLayerRef.current?.setAttribute('transform', `translate(0, ${pinned})`);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [svgRef, svgHeight, zoom]);

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
    <div style={{ position: 'relative' }}>
    <div
      ref={containerRef}
      onScroll={handleScroll}
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
      <svg ref={svgRef} width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
        <defs>
          <pattern id="timelineGrid" width={42 * zoom} height={42 * zoom} patternUnits="userSpaceOnUse">
            <path d={`M ${42 * zoom} 0 L 0 0 0 ${42 * zoom}`} fill="none" stroke={C.line} strokeWidth={0.8 * zoom} />
          </pattern>
          <linearGradient id="gateFace" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.gate} />
            <stop offset="100%" stopColor={C.accentDim} />
          </linearGradient>
          <linearGradient id="errorFace" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.errorBright} />
            <stop offset="100%" stopColor={C.errorDeep} />
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
          @keyframes regionSweep {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .region-tick {
            animation: regionSweep 240ms ease-out backwards;
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

        {/* Qubit lines (labels live in a pinned layer rendered on top) */}
        {Array.from({ length: data.num_qubits }).map((_, i) => (
          <g key={i}>
            <line x1={60 * zoom} y1={60 * zoom + i * H + H / 2} x2={totalWidth} y2={60 * zoom + i * H + H / 2} stroke={C.lineStrong} strokeWidth={strokeW * 1.6} opacity={0.45} />
            <line x1={60 * zoom} y1={60 * zoom + i * H + H / 2} x2={totalWidth} y2={60 * zoom + i * H + H / 2} stroke={C.qubit} strokeWidth={strokeW} opacity={0.34} strokeLinecap="round" />
          </g>
        ))}

        {/* Detecting Regions overlay: one continuous band per sensitivity
            segment, running from the instruction that created it to the
            instruction that changed or consumed it (e.g. the detector's
            measurement). Colors match the propagation overlay's Pauli colors. */}
        {showDetectingRegions && selectedDetector && data.detecting_regions?.[selectedDetector]?.length > 0 && (() => {
          const segments = data.detecting_regions[selectedDetector];
          const pauliColor = { X: C.error, Y: C.warning, Z: C.qubit };
          const maxTick = tickXPositions.length - 1;
          const timelineStartX = 60 * zoom;
          const bandH = H * 0.44;

          // x of a {tick, order} segment endpoint on a given qubit. The
          // instruction at that position always acts on the qubit, so the op
          // map gives its exact (subcolumn-aware) icon center. order==null is
          // a tick boundary; a null position means circuit start/end.
          const posX = (pos, qubit, fallback) => {
            if (!pos || pos.tick == null || pos.tick > maxTick) return fallback;
            if (pos.order == null) return tickXPositions[pos.tick];
            if (pos.tick >= maxTick) return fallback;
            const op = opMap[`${pos.tick}-${qubit}-${pos.order}`]?.[0];
            return getX(pos.tick, pos.order, op?.subColumn ?? 0, op?.totalSubColumns ?? 1);
          };

          // Stagger the fade-in by start tick so the detector's footprint
          // reads as propagating through time. Keyed on the detector so the
          // animation replays when the selection changes.
          const startTicks = [...new Set(segments.map(s => s.start?.tick ?? 0))].sort((a, b) => a - b);

          return (
            <g className="detecting-regions" key={`regions-${selectedDetector}`}>
              {segments.map((seg, i) => {
                const x1 = posX(seg.start, seg.qubit, timelineStartX);
                const x2 = posX(seg.end, seg.qubit, totalWidth);
                if (!(x2 > x1)) return null;
                const y = 60 * zoom + seg.qubit * H + H / 2;
                const color = pauliColor[seg.pauli] || C.textDim;
                const sweepDelay = `${startTicks.indexOf(seg.start?.tick ?? 0) * 30}ms`;
                return (
                  <rect
                    key={`region-${i}`}
                    className="region-tick"
                    style={{ animationDelay: sweepDelay }}
                    x={x1}
                    y={y - bandH / 2}
                    width={x2 - x1}
                    height={bandH}
                    fill={color}
                    fillOpacity={0.24}
                    stroke={color}
                    strokeOpacity={0.5}
                    strokeWidth={zoom}
                    rx={bandH / 2}
                  />
                );
              })}
            </g>
          );
        })()}

        {/* Tick separators (labels live in a vertically pinned layer below) */}
        {data.timeline.map((t, ti) => (
          <line
            key={ti}
            x1={tickXPositions[ti]}
            y1={52 * zoom}
            x2={tickXPositions[ti]}
            y2={svgHeight - 12 * zoom}
            stroke={C.line}
            strokeWidth={zoom}
            strokeDasharray={`${2 * zoom},${6 * zoom}`}
          />
        ))}

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
                    const y = 60 * zoom + qi * H + H / 2;

                    return ops.map((op, oi) => {
                      const hi = isHi(ti, qi, op);
                      const f = hi ? 'url(#glow)' : undefined;
                      const stroke = hi ? C.error : C.gate;

                      // Shared geometry (single-qubit ops have no subcolumns, so this
                      // reduces to the plain slot center for them)
                      const x = getX(ti, order, op.subColumn ?? 0, op.totalSubColumns ?? 1);
                      const partnerY = 60 * zoom + op.partner * H + H / 2;
                      const keySuffix = `${order}-${oi}-${op.subColumn ?? 0}`;

                      const triH = 10 * zoom;
                      const triW = 8 * zoom;
                      const ctrlR = 6 * zoom;
                      const tgtR = 11 * zoom;

                      // Hover tooltip: what the op is, where, and when
                      const isPair = op.partner !== undefined;
                      const qubitsStr = !isPair ? `q${qi}`
                        : op.name === 'CX'
                          ? (op.role === 'ctrl' ? `q${qi} ctrl → q${op.partner}` : `q${op.partner} ctrl → q${qi}`)
                          : `q${Math.min(qi, op.partner)}, q${Math.max(qi, op.partner)}`;
                      const kindLabel = op.type === 'error' ? 'Error channel'
                        : op.type === 'measure' ? 'Measurement'
                        : op.type === 'init' ? 'Reset' : 'Gate';
                      const tp = {
                        onMouseEnter: (e) => showTip(e, {
                          title: `${op.name}${op.rate != null ? `(${op.rate})` : ''}`,
                          sub: `${kindLabel} · ${qubitsStr} · t=${ti}${op.type === 'error' ? ' · click to trace' : ''}`,
                        }),
                        onMouseLeave: hideTip,
                      };

                      // Reusable fragments for the gate branches below
                      const pairLine = (
                        <line x1={x} y1={y} x2={x} y2={partnerY} stroke={stroke} strokeWidth={strokeW} />
                      );
                      const plusTarget = (
                        <>
                          <circle cx={x} cy={y} r={tgtR} fill="none" stroke={stroke} strokeWidth={strokeW} />
                          <line x1={x-tgtR} y1={y} x2={x+tgtR} y2={y} stroke={stroke} strokeWidth={strokeW} />
                          <line x1={x} y1={y-tgtR} x2={x} y2={y+tgtR} stroke={stroke} strokeWidth={strokeW} />
                        </>
                      );
                      const errorTriangle = (
                        <>
                          <polygon points={`${x},${y-triH} ${x+triW},${y+triH*0.6} ${x-triW},${y+triH*0.6}`} fill={hi ? 'url(#errorFace)' : C.errorDim} stroke={hi ? C.error : C.lineStrong} strokeWidth={zoom} />
                          <text x={x} y={y+zoom} fill={C.bg} fontSize={8*zoom} textAnchor="middle" dominantBaseline="middle" fontWeight="bold" fontFamily="var(--mono)">!</text>
                        </>
                      );
                      const sourceRing = (
                        <circle cx={x} cy={y} r={13 * zoom} fill="none" stroke={C.detectorBright} strokeWidth={1.6 * zoom} strokeDasharray={`${3 * zoom},${2.2 * zoom}`} filter="url(#glow)" />
                      );
                      const gateBox = (
                        <>
                          <rect x={x-gateHalf} y={y-gateHalf} width={gateSize} height={gateSize} fill={hi ? 'url(#errorFace)' : 'url(#gateFace)'} stroke={hi ? C.error : C.lineStrong} strokeWidth={zoom} rx={5 * zoom} />
                          <text x={x} y={y+1*zoom} fill={C.bg} fontSize={12*zoom} textAnchor="middle" dominantBaseline="middle" fontWeight="bold" fontFamily="var(--mono)">{op.name}</text>
                        </>
                      );

                      if (op.name === 'CX') {
                        // The control endpoint draws the connecting line
                        return (
                          <g {...tp} key={`gate-${keySuffix}`} filter={f}>
                            {op.role === 'ctrl' ? (
                              <>
                                {pairLine}
                                <circle cx={x} cy={y} r={ctrlR} fill={stroke} />
                              </>
                            ) : plusTarget}
                          </g>
                        );
                      }

                      if (op.name === 'XCX') {
                        return (
                          <g {...tp} key={`xcx-${keySuffix}`} filter={f}>
                            {qi < op.partner && pairLine}
                            {plusTarget}
                          </g>
                        );
                      }

                      if (op.name === 'CZ') {
                        return (
                          <g {...tp} key={`cz-${keySuffix}`} filter={f}>
                            {qi < op.partner && pairLine}
                            <circle cx={x} cy={y} r={ctrlR} fill={stroke} />
                          </g>
                        );
                      }

                      if (op.name === 'SWAP') {
                        const s = 8 * zoom;
                        return (
                          <g {...tp} key={`swap-${keySuffix}`} filter={f}>
                            {qi < op.partner && pairLine}
                            <line x1={x-s} y1={y-s} x2={x+s} y2={y+s} stroke={stroke} strokeWidth={strokeW} />
                            <line x1={x-s} y1={y+s} x2={x+s} y2={y-s} stroke={stroke} strokeWidth={strokeW} />
                          </g>
                        );
                      }

                      if (op.role === 'generic2q') {
                        return (
                          <g {...tp} key={`generic2q-${keySuffix}`} filter={f}>
                            {qi < op.partner && pairLine}
                            {gateBox}
                          </g>
                        );
                      }

                      if (op.name === 'DEPOLARIZE2' || op.name === 'PAULI_CHANNEL_2') {
                        return (
                          <g {...tp} {...errorClickProps(ti, op, op.pairQubits)} key={`err2-${keySuffix}`} filter={f}>
                            {op.role === 'first' && (
                              <line x1={x} y1={y} x2={x} y2={partnerY} stroke={hi ? C.error : C.errorDim} strokeWidth={strokeW} strokeDasharray={`${4*zoom},${2*zoom}`} />
                            )}
                            {isPropagationSource(ti, op, op.pairQubits) && sourceRing}
                            {errorTriangle}
                          </g>
                        );
                      }

                      if (op.type === 'error') {
                        return (
                          <g {...tp} {...errorClickProps(ti, op, [qi])} key={`err-${order}-${oi}`} filter={f}>
                            {isPropagationSource(ti, op, [qi]) && sourceRing}
                            {errorTriangle}
                          </g>
                        );
                      }

                      if (op.type === 'measure') {
                        // A measurement flipped by the propagated error reads as
                        // error-red; detector-selection highlighting stays amber
                        const isPropFlipped = propFlippedMeas.has(`${ti}-${qi}`);
                        const isMeasHighlighted = highlightedMeasurements.has(`${ti}-${qi}`);
                        const measColor = (hi || isPropFlipped) ? C.error : (isMeasHighlighted ? C.detectorBright : C.measure);
                        const measFilter = hi ? f : ((isMeasHighlighted || isPropFlipped) ? 'url(#glow)' : undefined);
                        const measBasis = op.name.includes('X') ? 'X' : op.name.includes('Y') ? 'Y' : 'Z';
                        // Measure-reset shows a meter and a ket side by side
                        const offset = op.name.startsWith('MR') ? gateHalf + 2 * zoom : 0;
                        return (
                          <g {...tp} key={`meas-${order}-${oi}`} filter={measFilter}>
                            <MeterIcon cx={x - offset} cy={y} color={measColor} zoom={zoom} basis={measBasis} C={C} />
                            {offset > 0 && <KetIcon cx={x + offset} cy={y} zoom={zoom} basis={measBasis} C={C} />}
                          </g>
                        );
                      }

                      if (op.type === 'init') {
                        const initBasis = op.name === 'RX' ? 'X' : op.name === 'RY' ? 'Y' : 'Z';
                        return (
                          <g {...tp} key={`init-${order}-${oi}`}>
                            <KetIcon cx={x} cy={y} zoom={zoom} basis={initBasis} C={C} />
                          </g>
                        );
                      }

                      if (op.type === 'gate') {
                        return (
                          <g {...tp} key={`gate-${order}-${oi}`} filter={f}>
                            {gateBox}
                          </g>
                        );
                      }

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
          const labelText = d.event_fraction != null
            ? `${d.name} · ${(d.event_fraction * 100).toFixed(2)}%`
            : d.name;
          const labelWidth = Math.max(30, labelText.length * 6.4 + 14) * zoom;

          return (
            <g
              key={d.name}
              ref={sel ? selectedDetectorRef : null}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedDetector(sel ? null : d.name)}
              onMouseEnter={() => setHoveredDetector(d.name)}
              onMouseLeave={() => setHoveredDetector(null)}
            >
              {propFlippedDetectors.has(d.name) && (
                <circle
                  className="region-tick"
                  cx={baseX}
                  cy={y}
                  r={radius + 5 * zoom}
                  fill="none"
                  stroke={C.error}
                  strokeWidth={1.6 * zoom}
                  strokeDasharray={`${3 * zoom},${2.2 * zoom}`}
                />
              )}
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
                    {labelText}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Error propagation overlay: the toggled error's Pauli frame at each
            tick (trail band on the qubit line + letter badge above it). A
            one-shot staggered fade-in makes the path read left-to-right. */}
        {propagation?.frames && (() => {
          const pauliColor = { X: C.error, Y: C.warning, Z: C.qubit };
          const frameTicks = Object.keys(propagation.frames)
            .map(Number)
            .filter(t => t < tickXPositions.length - 1)
            .sort((a, b) => a - b);
          // Frames record the Pauli *entering* a tick; when a reset inside
          // that tick absorbs it (qubit gone from the next tick's frame), end
          // the trail at the reset icon rather than spanning the full column,
          // so the error doesn't appear to outlive the reset.
          const frameAbsorbX = (t, qubit) => {
            const nextFrame = propagation.frames[t + 1];
            if (nextFrame && nextFrame.some(f => f.qubit === qubit)) return null;
            let absorber = null;
            for (const op of (data.timeline[t]?.ops || [])) {
              const isReset = op.type === 'init' || (op.type === 'measure' && op.name.startsWith('MR'));
              if (!isReset) continue;
              const qubits = Array.isArray(op.qubits[0]) ? op.qubits.flat() : op.qubits;
              if (!qubits.includes(qubit)) continue;
              const order = op.order ?? 0;
              if (absorber === null || order < absorber.order) absorber = { order, isMR: op.name.startsWith('MR') };
            }
            if (absorber === null) return null;
            const opX = getX(t, absorber.order);
            // MR draws meter|ket around opX: the frame flips the meter, so the
            // trail reaches it but stops before the ket. Pure resets stop at
            // the ket's left edge.
            return absorber.isMR ? opX : opX - gateHalf;
          };
          return (
            <g key={`prop-${propagation.key}-${propagation.activePauli}`} style={{ pointerEvents: 'none' }}>
              {frameTicks.map((t, i) => {
                const x1 = tickXPositions[t];
                const xFull = tickXPositions[t + 1];
                const x2 = xFull - (ticksWithDetectors.has(t) ? detectorPadding : 0);
                return (
                  <g key={`prop-${t}`} className="region-tick" style={{ animationDelay: `${i * 40}ms` }}>
                    {propagation.frames[t].map(({ qubit, pauli }) => {
                      const y = 60 * zoom + qubit * H + H / 2;
                      const color = pauliColor[pauli] || C.error;
                      const badgeY = y - 17 * zoom;
                      const absorbX = frameAbsorbX(t, qubit);
                      // Detector markers annotate the record, not the qubit:
                      // when the frame survives into the next tick, run the
                      // band through the detector padding so the trail reads
                      // as one continuous path.
                      const continues = propagation.frames[t + 1]?.some(f => f.qubit === qubit);
                      const bandEnd = absorbX !== null
                        ? Math.min(Math.max(absorbX, x1), x2)
                        : (continues ? xFull : x2);
                      const xc = (x1 + Math.min(bandEnd, x2)) / 2;
                      return (
                        <g key={`prop-${t}-q${qubit}`}>
                          <rect
                            x={x1}
                            y={y - 4 * zoom}
                            width={Math.max(bandEnd - x1, 0)}
                            height={8 * zoom}
                            fill={color}
                            opacity={0.2}
                            rx={4 * zoom}
                          />
                          <circle cx={xc} cy={badgeY} r={8.5 * zoom} fill={color} opacity={0.94} stroke={C.bg} strokeWidth={zoom} />
                          <text
                            x={xc}
                            y={badgeY + zoom}
                            fill={C.bg}
                            fontSize={10 * zoom}
                            fontWeight="800"
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontFamily="var(--mono)"
                          >
                            {pauli}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Pinned qubit labels: counter-translated on scroll so they stay visible */}
        <g ref={labelLayerRef} data-pinned-labels="true" style={{ pointerEvents: 'none' }}>
          <rect x={0} y={52 * zoom} width={54 * zoom} height={svgHeight - 52 * zoom} fill={C.field} opacity={0.86} />
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
            </g>
          ))}
        </g>

        {/* Pinned tick labels: counter-translated against the ancestor's
            vertical scroll so the t=N row stays visible on tall circuits */}
        <g ref={tickLabelLayerRef} data-pinned-tick-labels="true" style={{ pointerEvents: 'none' }}>
          <rect x={0} y={0} width={svgWidth} height={44 * zoom} fill={C.field} opacity={0.86} />
          {data.timeline.map((t, ti) => {
            const tickCenter = (tickXPositions[ti] + tickXPositions[ti + 1]) / 2;
            return (
              <text key={ti} x={tickCenter} y={38 * zoom} fill={C.textDim} fontSize={11 * zoom} textAnchor="middle" fontFamily="var(--mono)">t={ti}</text>
            );
          })}
        </g>
      </svg>
    </div>
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(tooltip.x + 14, (containerRef.current?.clientWidth ?? 600) - 170),
            top: tooltip.y - 14,
            transform: 'translateY(-100%)',
            maxWidth: 260,
            padding: '7px 10px',
            background: C.glassStrong,
            border: `1px solid ${C.lineStrong}`,
            borderRadius: 7,
            boxShadow: C.shadowSoft,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div style={{ color: C.text, fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
            {tooltip.title}
          </div>
          <div style={{ color: C.textDim, fontSize: 11, marginTop: 2, whiteSpace: 'nowrap' }}>
            {tooltip.sub}
          </div>
        </div>
      )}
    </div>
  );
}
