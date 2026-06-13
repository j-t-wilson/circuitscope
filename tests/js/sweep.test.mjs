// Tests for the parameter sweep math (src/utils/sweep.js).
//
// Run with: npm run test:js   (node --test, no dependencies)

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeEventFraction } from '../../src/utils/eventFraction.js';
import {
  GLOBAL_SCALE,
  logSpace,
  maxAllowedValue,
  paramsAtSweep,
  sweepAxis,
  sweepCurve,
  uniformScaleOf,
} from '../../src/utils/sweep.js';

// Two live parameters with current values equal to nominal.
function makeParams() {
  return [
    { name: 'p_x_error_0_01', gate_type: 'X_ERROR', original_value: 0.01, value: 0.01, count: 3 },
    { name: 'p_depolarize1_0_002', gate_type: 'DEPOLARIZE1', original_value: 0.002, value: 0.002, count: 4 },
  ];
}

const near = (a, b, tol = 1e-12) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('logSpace hits both endpoints and is monotone', () => {
  const xs = logSpace(1e-4, 1e2, 61);
  assert.equal(xs.length, 61);
  near(xs[0], 1e-4, 1e-16);
  near(xs[60], 1e2, 1e-10);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
});

test('sweepAxis spans two decades around nominal, clamped at the gate maximum', () => {
  const params = makeParams();
  const axis = sweepAxis(params, 'p_x_error_0_01');
  near(axis[0], 1e-4, 1e-16);
  // 0.01 × 100 = 1.0 would exceed the X_ERROR maximum of 0.5
  near(axis[axis.length - 1], 0.5, 1e-12);

  const axisD = sweepAxis(params, 'p_depolarize1_0_002');
  near(axisD[0], 2e-5, 1e-16);
  near(axisD[axisD.length - 1], 0.2, 1e-12); // under the 0.75 max, no clamp

  const axisK = sweepAxis(params, GLOBAL_SCALE);
  near(axisK[0], 0.01, 1e-14);
  near(axisK[axisK.length - 1], 100, 1e-10);
});

test('paramsAtSweep replaces only the swept parameter and clamps at the maximum', () => {
  const params = makeParams();
  const at = paramsAtSweep(params, 'p_x_error_0_01', 0.03);
  near(at[0].value, 0.03);
  near(at[1].value, 0.002); // untouched
  assert.notEqual(at[0], params[0]); // no mutation
  near(params[0].value, 0.01);

  const clamped = paramsAtSweep(params, 'p_x_error_0_01', 0.9);
  near(clamped[0].value, maxAllowedValue('X_ERROR'));
});

test('GLOBAL_SCALE multiplies nominal values and clamps per gate', () => {
  const params = makeParams();
  // Give the X_ERROR param an override; ×k must still scale from nominal
  params[0].value = 0.04;
  const at = paramsAtSweep(params, GLOBAL_SCALE, 10);
  near(at[0].value, 0.1); // 10 × 0.01, not 10 × 0.04
  near(at[1].value, 0.02);

  const big = paramsAtSweep(params, GLOBAL_SCALE, 1000);
  near(big[0].value, 0.5); // X_ERROR max
  near(big[1].value, 0.75); // DEPOLARIZE1 max
});

test('GLOBAL_SCALE at k=1 reproduces the nominal event fraction', () => {
  const params = makeParams();
  const nominal = computeEventFraction(params);
  const atK1 = computeEventFraction(paramsAtSweep(params, GLOBAL_SCALE, 1));
  near(atK1, nominal);
});

test('sweepCurve is monotone increasing for a single-Pauli parameter', () => {
  const params = makeParams();
  const curve = sweepCurve(params, 'p_x_error_0_01', computeEventFraction, { points: 41 });
  assert.equal(curve.length, 41);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].y > curve[i - 1].y, `not increasing at index ${i}`);
  }
  // Endpoints stay physical
  assert.ok(curve[0].y > 0);
  assert.ok(curve[curve.length - 1].y <= 0.5 + 1e-12);
});

test('uniformScaleOf detects a uniform scale and rejects mixed overrides', () => {
  const params = makeParams();
  near(uniformScaleOf(params), 1);

  params[0].value = 0.03;
  params[1].value = 0.006;
  near(uniformScaleOf(params), 3, 1e-9);

  params[1].value = 0.005;
  assert.equal(uniformScaleOf(params), null);

  // Zero-nominal parameters carry no scale information
  const withZero = [
    ...makeParams(),
    { name: 'p_zero', gate_type: 'Z_ERROR', original_value: 0, value: 0, count: 1 },
  ];
  withZero[0].value = 0.02;
  withZero[1].value = 0.004;
  near(uniformScaleOf(withZero), 2, 1e-9);
});
