// Tests for the measured-data parameter fit (src/utils/parameterFit.js).
//
// Strategy mirrors the Python cross-method tests: generate "measured"
// fractions exactly from the analytical model with deliberately perturbed
// rates, then check the fit recovers the perturbation.
//
// Run with: npm run test:js   (node --test, no dependencies)

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeDetectorFractions, getEffectiveP } from '../../src/utils/eventFraction.js';
import { runFit, rateFromX } from '../../src/utils/parameterFit.js';

const SHOTS = 1_000_000;

// A small synthetic model: 8 detectors, three live parameters with
// non-proportional count columns, one parameter with no leverage.
function makeModel() {
  return {
    num_detectors: 8,
    parameters: [
      { name: 'p_x_error_0_001', gate_type: 'X_ERROR', original_value: 0.001, count: 11 },
      { name: 'p_depolarize1_0_002', gate_type: 'DEPOLARIZE1', original_value: 0.002, count: 24 },
      { name: 'p_z_error_0_005', gate_type: 'Z_ERROR', original_value: 0.005, count: 5 },
      { name: 'p_x_error_0_003', gate_type: 'X_ERROR', original_value: 0.003, count: 0 },
    ],
    detector_counts: {
      p_x_error_0_001: [2, 1, 0, 3, 2, 1, 2, 0],
      p_depolarize1_0_002: [4, 4, 4, 4, 2, 2, 2, 2],
      p_z_error_0_005: [1, 0, 1, 0, 1, 0, 1, 1],
      p_x_error_0_003: [0, 0, 0, 0, 0, 0, 0, 0],
    },
  };
}

// Exact model fractions under the given parameter values (no sampling noise).
function measuredFrom(model, values, shots = SHOTS) {
  const params = model.parameters.map(p => ({
    ...p,
    value: values[p.name] ?? p.original_value,
  }));
  const fractions = {};
  computeDetectorFractions(params, model.detector_counts, model.num_detectors)
    .forEach((f, i) => { fractions[`D${i}`] = f; });
  return { fractions, shots };
}

function assertNear(actual, expected, relTol, msg) {
  const tol = Math.abs(expected) * relTol + 1e-12;
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg}: expected ${expected}, got ${actual} (tol ${tol})`
  );
}

test('rateFromX inverts the effective-probability transform', () => {
  for (const [gate, rate] of [
    ['X_ERROR', 0.0042],
    ['DEPOLARIZE1', 0.002],
    ['DEPOLARIZE2', 0.013],
  ]) {
    const x = Math.log(1 - 2 * getEffectiveP(gate, rate));
    assertNear(rateFromX(gate, x), rate, 1e-9, `${gate} roundtrip`);
  }
});

test('single perturbed knob is ranked first and recovered', () => {
  const model = makeModel();
  const measured = measuredFrom(model, { p_x_error_0_001: 0.0018 });
  const fit = runFit(model, measured);

  assert.ok(fit.nominal.perDof > 10, 'nominal model should fit poorly');
  const best = fit.singles[0];
  assert.equal(best.changes[0].name, 'p_x_error_0_001');
  assertNear(best.changes[0].to, 0.0018, 1e-3, 'fitted rate');
  assertNear(best.changes[0].mult, 1.8, 1e-3, 'multiplier');
  assert.ok(best.fit.perDof < 0.01, 'best scenario should fit (noise-free data)');
  // Other single knobs cannot explain the same residual pattern
  assert.ok(fit.singles[1].fit.chi2 > 100 * best.fit.chi2 + 1, 'ranking separates knobs');
});

test('dense fit recovers a two-knob perturbation with finite sigmas', () => {
  const model = makeModel();
  const truth = { p_x_error_0_001: 0.0016, p_depolarize1_0_002: 0.0011 };
  const fit = runFit(model, measuredFrom(model, truth));

  for (const change of fit.dense.changes) {
    const expected = truth[change.name] ?? model.parameters.find(p => p.name === change.name).original_value;
    assertNear(change.to, expected, 5e-3, `dense fit for ${change.name}`);
    if (!change.clamped) {
      const sigma = fit.dense.sigmas[change.name];
      assert.ok(Number.isFinite(sigma) && sigma > 0, `sigma for ${change.name}`);
    }
  }
  assert.ok(fit.dense.fit.perDof < 0.01, 'dense fit should be near-perfect on noise-free data');
});

test('two-knob greedy scenario beats the best single when two knobs moved', () => {
  const model = makeModel();
  const truth = { p_x_error_0_001: 0.002, p_z_error_0_005: 0.009 };
  const fit = runFit(model, measuredFrom(model, truth));

  const bestPair = fit.pairs[0];
  assert.ok(bestPair.fit.chi2 < fit.singles[0].fit.chi2 / 10, 'pair should improve on single');
  const names = bestPair.changes.map(c => c.name).sort();
  assert.deepEqual(names, ['p_x_error_0_001', 'p_z_error_0_005']);
});

test('rates clamp at zero instead of going negative', () => {
  const model = makeModel();
  // Data generated with two rates *below* nominal; explaining it with the
  // X_ERROR knob alone would require a negative rate.
  const measured = measuredFrom(model, { p_x_error_0_001: 0, p_depolarize1_0_002: 0.0008 });
  const fit = runFit(model, measured);

  const xKnob = fit.singles.find(s => s.changes[0].name === 'p_x_error_0_001');
  assert.equal(xKnob.changes[0].to, 0);
  assert.equal(xKnob.changes[0].clamped, true);
});

test('parameters with no leverage are reported, not fit', () => {
  const model = makeModel();
  const fit = runFit(model, measuredFrom(model, { p_x_error_0_001: 0.0015 }));
  assert.deepEqual(fit.noLeverage, ['p_x_error_0_003']);
  for (const s of fit.singles) {
    assert.notEqual(s.changes[0].name, 'p_x_error_0_003');
  }
});

test('proportional count columns are reported as degenerate groups', () => {
  const model = {
    num_detectors: 4,
    parameters: [
      { name: 'p_a', gate_type: 'X_ERROR', original_value: 0.001, count: 4 },
      { name: 'p_b', gate_type: 'Z_ERROR', original_value: 0.002, count: 8 },
      { name: 'p_c', gate_type: 'X_ERROR', original_value: 0.004, count: 5 },
    ],
    detector_counts: {
      p_a: [1, 1, 1, 1],
      p_b: [2, 2, 2, 2], // exactly proportional to p_a
      p_c: [2, 1, 1, 1],
    },
  };
  const fit = runFit(model, measuredFrom(model, { p_a: 0.002 }));
  assert.equal(fit.degenerateGroups.length, 1);
  assert.deepEqual(fit.degenerateGroups[0].sort(), ['p_a', 'p_b']);
  // The dense fit must stay finite despite the rank deficiency
  for (const change of fit.dense.changes) {
    assert.ok(Number.isFinite(change.to) && change.to >= 0, `finite rate for ${change.name}`);
  }
});

test('detector copies (identical rows) are counted as one pattern', () => {
  const model = makeModel();
  const fit = runFit(model, measuredFrom(model, {}));
  // Rows D5 ([1,2,0,0]) and ... — count distinct count-rows directly
  const expected = new Set(
    Array.from({ length: model.num_detectors }, (_, d) =>
      model.parameters.map(p => model.detector_counts[p.name][d]).join(',')
    )
  ).size;
  assert.equal(fit.uniquePatterns, expected);
});

test('without shots the fit still runs and ranks by RMS', () => {
  const model = makeModel();
  const measured = measuredFrom(model, { p_z_error_0_005: 0.011 }, null);
  const fit = runFit(model, measured);

  assert.equal(fit.nominal.chi2, null);
  assert.ok(fit.nominal.rms > 0);
  const best = fit.singles[0];
  assert.equal(best.changes[0].name, 'p_z_error_0_005');
  assertNear(best.changes[0].to, 0.011, 1e-3, 'fitted rate without shots');
});

test('saturated measured fractions produce a warning, not a crash', () => {
  const model = makeModel();
  const measured = measuredFrom(model, {});
  measured.fractions.D0 = 0.62;
  const fit = runFit(model, measured);
  assert.ok(fit.warnings.some(w => w.includes('D0')));
});
