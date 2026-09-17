import assert from 'node:assert/strict';
import { normalizeEIA, SERIES } from '../scripts/refresh-energy.mjs';

const pts = normalizeEIA([
  { period: '2026-09-04', value: '421234' },
  { period: '2026-08-28', value: 423100 },
  { period: '2026-09-04', value: '421234' },   // duplicate
  { period: '2026-08-21', value: null },       // missing
  { period: 'bad', value: '1' },               // malformed
]);
assert.deepEqual(pts, [['2026-08-28', 423100], ['2026-09-04', 421234]]);
assert.ok(SERIES.crude.required && SERIES.gas.required);
assert.equal(Object.values(SERIES).filter((s) => s.required).length, 2);
console.log('energy tests pass');
