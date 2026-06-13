// Parameter sweep math (Analysis view sweep chart).
//
// A sweep recomputes the event fraction while one knob moves over a log range
// and every other parameter stays at its current (possibly overridden) value.
// The special GLOBAL_SCALE knob is the "all noise × k" multiplier: every
// parameter becomes k × its nominal rate.

export const GLOBAL_SCALE = '__global_scale__';

// Physical maximum for each gate's probability argument (matches the bound
// enforced by the ParameterInput number field).
export function maxAllowedValue(gateType) {
  if (gateType === 'DEPOLARIZE1') return 0.75;
  if (gateType === 'DEPOLARIZE2') return 0.9375;
  return 0.5;
}

// `points` log-spaced values from lo to hi inclusive.
export function logSpace(lo, hi, points) {
  if (points <= 1) return [lo];
  const llo = Math.log(lo);
  const step = (Math.log(hi) - llo) / (points - 1);
  return Array.from({ length: points }, (_, i) => Math.exp(llo + step * i));
}

// The sweep axis: `decades` either side of the nominal value, clamped to the
// gate's physical maximum. For GLOBAL_SCALE the axis is the multiplier k.
export function sweepAxis(params, sweptName, { decades = 2, points = 121 } = {}) {
  const span = Math.pow(10, decades);
  if (sweptName === GLOBAL_SCALE) return logSpace(1 / span, span, points);
  const p = params.find(q => q.name === sweptName);
  const center = p && p.original_value > 0 ? p.original_value : 1e-3;
  const hi = Math.min(center * span, p ? maxAllowedValue(p.gate_type) : 0.5);
  return logSpace(center / span, hi, points);
}

// Parameter values at one sweep coordinate. For a named parameter, x is its
// probability; everything else keeps its current value. For GLOBAL_SCALE, x
// is the multiplier applied to every parameter's *nominal* value (so k is
// well-defined even when individual overrides are active). Values clamp at
// each gate's physical maximum.
export function paramsAtSweep(params, sweptName, x) {
  if (sweptName === GLOBAL_SCALE) {
    return params.map(p => ({
      ...p,
      value: Math.min(x * p.original_value, maxAllowedValue(p.gate_type)),
    }));
  }
  return params.map(p => (
    p.name === sweptName ? { ...p, value: Math.min(x, maxAllowedValue(p.gate_type)) } : p
  ));
}

// Full curve: [{x, y}] with y = evaluate(params at x).
export function sweepCurve(params, sweptName, evaluate, opts = {}) {
  return sweepAxis(params, sweptName, opts)
    .map(x => ({ x, y: evaluate(paramsAtSweep(params, sweptName, x)) }));
}

// If the current values are exactly a uniform scale k of the nominal values,
// return k; otherwise null. Used to place the current-value marker on the
// GLOBAL_SCALE chart (with heterogeneous overrides there is no single k).
export function uniformScaleOf(params) {
  let k = null;
  for (const p of params) {
    if (!(p.original_value > 0)) continue;
    const r = p.value / p.original_value;
    if (k === null) k = r;
    else if (Math.abs(r - k) > 1e-9 * Math.max(1, k)) return null;
  }
  return k;
}
