import assert from 'node:assert/strict';
import { normalizeRates, normalizeMovements } from '../scripts/refresh.mjs';

const longSchema = [
  { field: 'date', name: 'Date', type: 'calendar_date' },
  { field: 'location', name: 'Location', type: 'text' },
  { field: 'rate', name: 'Rate', type: 'number' },
];
const locs = ['Twin Cities', 'Mid-Mississippi', 'Illinois River', 'St. Louis', 'Cincinnati', 'Lower Ohio', 'Cairo-Memphis'];
const longRows = locs.map((l) => ({ date: '2026-09-08T00:00:00.000', location: l, rate: '200' }));
const r1 = normalizeRates(longSchema, longRows);
assert.deepEqual(r1.stlouis, [['2026-09-08', 200, 7.98]]);
assert.deepEqual(r1.twin, [['2026-09-08', 200, 12.38]]); // AMS worked example

const wideSchema = [
  { field: 'date', name: 'Date', type: 'calendar_date' },
  ...[['twc','Twin Cities'],['mm','Mid-Mississippi'],['ill','Illinois'],['st_louis','St. Louis'],['cinc','Cincinnati'],['loh','Lower Ohio'],['car_mem','Cairo-Memphis']]
    .map(([f, n]) => ({ field: f, name: n, type: 'number' })),
];
const r2 = normalizeRates(wideSchema, [{ date: '2026-09-08T00:00:00.000', twc: null, mm: '300', ill: '310', st_louis: '250', cinc: '280', loh: '280', car_mem: '220' }]);
assert.equal(r2.twin.length, 0);
assert.deepEqual(r2.cairo, [['2026-09-08', 220, 6.91]]);

assert.throws(() => normalizeRates(longSchema, longRows.map((r) => ({ ...r, rate: '12' }))), /looks like \$\/ton/);

const mSchema = [
  { field: 'week', name: 'Week Ending', type: 'calendar_date' },
  { field: 'lock', name: 'Lock', type: 'text' },
  { field: 'commodity', name: 'Commodity', type: 'text' },
  { field: 'tons', name: 'Tons', type: 'number' },
];
const m = normalizeMovements(mSchema, [
  { week: '2026-09-05', lock: 'Miss Locks 27', commodity: 'Corn', tons: '400000' },
  { week: '2026-09-05', lock: 'Miss Locks 27', commodity: 'Soybeans', tons: '100000' },
  { week: '2026-09-05', lock: 'Ohio Olmstead', commodity: 'Corn', tons: '50000' },
]);
assert.deepEqual(m.weeks, [{ d: '2026-09-05', byLock: { 'Miss Locks 27': 500000, 'Ohio Olmstead': 50000 } }]);
console.log('all normalize tests pass');
