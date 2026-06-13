// Tests for measured-data parsing, validation, comparison stats, and
// persistence (src/utils/measuredData.js).
//
// These cover the import path that feeds the whole measured-vs-model surface:
// turning pasted CSV/JSON into a {fractions, shots} object, flagging bad input,
// computing the z-scores shown on detector cards, and the localStorage round
// trip used to restore a dataset when the same circuit is re-analyzed.
//
// Run with: npm run test:js   (node --test, no dependencies)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMeasuredData,
  validateMeasuredData,
  compareDetector,
  buildComparison,
  formatZ,
  readStoredMeasuredData,
  saveStoredMeasuredData,
} from '../../src/utils/measuredData.js';

function assertNear(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected}, got ${actual}`);
}

// Minimal in-memory localStorage so the persistence helpers run under node.
function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  return store;
}

// --- parsing -------------------------------------------------------------

test('parses CSV with named detectors and a shots line', () => {
  const { fractions, shots } = parseMeasuredData(
    'detector, fraction\nD0, 0.0214\nD1, 0.0198\nshots, 100000'
  );
  assert.deepEqual(fractions, { D0: 0.0214, D1: 0.0198 });
  assert.equal(shots, 100000);
});

test('parses bare per-line fractions in detector order', () => {
  const { fractions, shots } = parseMeasuredData('0.01\n0.02\n0.03');
  assert.deepEqual(fractions, { D0: 0.01, D1: 0.02, D2: 0.03 });
  assert.equal(shots, null);
});

test('accepts bare numeric and "12" style detector ids, normalizing to D12', () => {
  const { fractions } = parseMeasuredData('12, 0.05\nd7, 0.06');
  assert.deepEqual(fractions, { D12: 0.05, D7: 0.06 });
});

test('parses JSON array, name map, and {shots, fractions} wrapper', () => {
  assert.deepEqual(parseMeasuredData('[0.01, 0.02]').fractions, { D0: 0.01, D1: 0.02 });
  assert.deepEqual(parseMeasuredData('{"D0": 0.01, "1": 0.02}').fractions, { D0: 0.01, D1: 0.02 });

  const wrapped = parseMeasuredData('{"shots": 50000, "fractions": {"D0": 0.01}}');
  assert.deepEqual(wrapped.fractions, { D0: 0.01 });
  assert.equal(wrapped.shots, 50000);
});

test('rejects mixed named and bare line styles', () => {
  assert.throws(() => parseMeasuredData('D0, 0.01\n0.02'), /Mix of named/);
});

test('rejects empty, malformed JSON, and unrecognized keys', () => {
  assert.throws(() => parseMeasuredData('   '), /No data/);
  assert.throws(() => parseMeasuredData('[0.01, '), /JSON but failed to parse/);
  assert.throws(() => parseMeasuredData('{"bogus": 0.01}'), /Unrecognized detector key/);
});

// --- validation ----------------------------------------------------------

const detectors = [{ name: 'D0' }, { name: 'D1' }, { name: 'D2' }];

test('flags out-of-range fractions and unknown detectors as errors', () => {
  const oob = validateMeasuredData({ fractions: { D0: 1.5 }, shots: 100 }, detectors);
  assert.ok(oob.errors.some(e => /\[0, 1\]/.test(e)));

  const unknown = validateMeasuredData({ fractions: { D9: 0.01 }, shots: 100 }, detectors);
  assert.ok(unknown.errors.some(e => /not in this circuit/.test(e)));
});

test('warns on partial coverage and on a missing shot count', () => {
  const { errors, warnings } = validateMeasuredData(
    { fractions: { D0: 0.01 }, shots: null },
    detectors
  );
  assert.equal(errors.length, 0);
  assert.ok(warnings.some(w => /covers 1 of 3/.test(w)));
  assert.ok(warnings.some(w => /No shot count/.test(w)));
});

// --- comparison statistics ----------------------------------------------

test('compareDetector computes sigma and z under the model-correct hypothesis', () => {
  const shots = 10000;
  const model = 0.02;
  const measured = 0.025;
  const c = compareDetector(model, measured, shots);

  assertNear(c.delta, 0.005, 1e-12, 'delta');
  assertNear(c.sigma, Math.sqrt(model * (1 - model) / shots), 1e-12, 'sigma');
  assertNear(c.z, c.delta / c.sigma, 1e-12, 'z');
});

test('compareDetector floors variance at 1/shots^2 when the model predicts 0', () => {
  const shots = 1000;
  const c = compareDetector(0, 0.003, shots);
  // sigma = sqrt(max(0, 1/shots)/shots) = 1/shots, so z = delta * shots = events.
  assertNear(c.sigma, 1 / shots, 1e-12, 'floored sigma');
  assertNear(c.z, 3, 1e-9, 'z equals observed event count');
});

test('compareDetector returns null sigma/z without shots', () => {
  const c = compareDetector(0.02, 0.03, null);
  assert.equal(c.sigma, null);
  assert.equal(c.z, null);
  assertNear(c.delta, 0.01, 1e-12, 'delta still computed');
});

test('buildComparison maps only detectors with measured data, else null', () => {
  const dets = [
    { name: 'D0', event_fraction: 0.02 },
    { name: 'D1', event_fraction: 0.03 },
  ];
  const comparison = buildComparison(dets, { fractions: { D1: 0.04 }, shots: 10000 });
  assert.deepEqual(Object.keys(comparison), ['D1']);

  assert.equal(buildComparison(dets, { fractions: {}, shots: 10000 }), null);
  assert.equal(buildComparison(dets, null), null);
});

test('formatZ formats sign, precision, and clamps beyond 99 sigma', () => {
  assert.equal(formatZ(null), null);
  assert.equal(formatZ(2.34), '+2.3σ');
  assert.equal(formatZ(-1.21), '-1.2σ');
  assert.equal(formatZ(150), '>+99σ');
  assert.equal(formatZ(-150), '<-99σ');
});

// --- persistence ---------------------------------------------------------

test('measured data round-trips through localStorage with its circuit', () => {
  installLocalStorage();
  const circuit = 'X_ERROR(0.01) 0';
  const data = { shots: 100000, fractions: { D0: 0.01 } };

  saveStoredMeasuredData(circuit, data);
  const restored = readStoredMeasuredData();

  assert.equal(restored.circuit, circuit);
  assert.equal(restored.shots, 100000);
  assert.deepEqual(restored.fractions, data.fractions);
});

test('saving null clears stored measured data', () => {
  installLocalStorage();
  saveStoredMeasuredData('circuit', { shots: 1, fractions: { D0: 0.01 } });
  saveStoredMeasuredData('circuit', null);
  assert.equal(readStoredMeasuredData(), null);
});

test('readStoredMeasuredData tolerates absent and corrupt storage', () => {
  installLocalStorage();
  assert.equal(readStoredMeasuredData(), null);
  globalThis.localStorage.setItem('circuitscope-measured-data', '{not json');
  assert.equal(readStoredMeasuredData(), null);
});
