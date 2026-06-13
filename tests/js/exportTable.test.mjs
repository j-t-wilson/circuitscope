import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, toJson } from '../../src/utils/exportTable.js';

const COLUMNS = [
  { key: 'detector', label: 'detector' },
  { key: 'model_fraction', label: 'model_fraction' },
  { key: 'z', label: 'z' },
];

test('csvCell quotes only when needed', () => {
  assert.equal(csvCell('D0'), 'D0');
  assert.equal(csvCell(0.0214), '0.0214');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
});

test('toCsv renders header and one line per row, empty cells for missing values', () => {
  const rows = [
    { detector: 'D0', model_fraction: 0.021, z: 1.5 },
    { detector: 'D1', model_fraction: 0.034, z: null },
  ];
  assert.equal(
    toCsv(COLUMNS, rows),
    'detector,model_fraction,z\nD0,0.021,1.5\nD1,0.034,\n'
  );
});

test('toCsv of an empty table is just the header', () => {
  assert.equal(toCsv(COLUMNS, []), 'detector,model_fraction,z\n');
});

test('toJson keeps numbers as numbers and omits null cells', () => {
  const rows = [{ detector: 'D0', model_fraction: 0.021, z: null }];
  const parsed = JSON.parse(toJson(COLUMNS, rows));
  assert.deepEqual(parsed, [{ detector: 'D0', model_fraction: 0.021 }]);
});

test('toJson drops keys not declared as columns', () => {
  const rows = [{ detector: 'D0', model_fraction: 0.021, z: 2, extra: 'nope' }];
  const parsed = JSON.parse(toJson(COLUMNS, rows));
  assert.deepEqual(parsed, [{ detector: 'D0', model_fraction: 0.021, z: 2 }]);
});
