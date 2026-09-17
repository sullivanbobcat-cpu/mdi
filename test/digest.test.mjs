import assert from 'node:assert/strict';
import { buildFacts, weekly, daily, fiveYearAvg } from '../scripts/facts.mjs';
import { validateDraft, parseDraft } from '../scripts/digest.mjs';

// Weekly stats: same ISO week across prior five years
const pts = [];
for (let y = 2021; y <= 2026; y++) pts.push([`${y}-09-04`, 400000 + (y - 2021) * 1000]);
pts.splice(pts.length - 1, 0, ['2026-08-28', 426000]);
const w = weekly(pts, { scale: 1 / 1000, dp: 1 });
assert.equal(w.value, 405);                  // 405,000 kbbl -> 405.0 M bbl
assert.equal(w.weeklyChange, -21);           // 405 - 426
assert.equal(w.fiveYearAvgSameWeek, 403);    // ISO week 36 only matches 2023-2025: avg of 402..404
assert.equal(w.vsFiveYearAvgPct, 0.5);
assert.equal(fiveYearAvg([['2026-09-04', 1]], '2026-09-04'), null);

const dly = daily([['2026-09-01', 70], ['2026-09-08', 72.5], ['2026-09-15', 73.456]]);
assert.equal(dly.value, 73.46);
assert.equal(dly.weekAgoValue, 72.5);
assert.equal(dly.weeklyChange, 0.96);

// Facts from a tiny rates file
const rates = {
  locations: [{ key: 'stlouis', label: 'St. Louis' }, { key: 'twin', label: 'Twin Cities' }],
  series: { stlouis: [['2026-09-01', 682.7, 27.24], ['2026-09-08', 792.2, 31.61]], twin: [['2026-07-01', 500, 30.95]] },
};
const facts = buildFacts({ rates });
const stl = facts.grainBargeFreight.origins['St. Louis'];
assert.equal(stl.value, 31.61);
assert.equal(stl.weeklyChange, 4.37);
assert.equal(stl.weeklyChangePct, 16);
assert.match(facts.grainBargeFreight.origins['Twin Cities'].status, /no recent quote/);

// Validator
const good = {
  title: 'St. Louis barge freight up 16% on the week',
  summary: 'Rates rose to $31.61 a ton for the week of Sep 8, 2026.',
  body_markdown: '## What moved\nSt. Louis rose $4.37 to $31.61 per ton, about 16%.\n## The fundamental read\nConsistent with harvest demand.\n## What to watch\nIf rates hold near $32, the five-year gap stays wide.',
};
assert.deepEqual(validateDraft(good, facts), []);
const bad = { ...good, body_markdown: good.body_markdown + '\nTraders should buy corn; WTI could hit 105.' };
const issues = validateDraft(bad, facts);
assert.ok(issues.some((i) => /trading-advice/.test(i)));
assert.ok(issues.some((i) => /105/.test(i)));
assert.ok(validateDraft({ ...good, body_markdown: 'no sections' }, facts).some((i) => /missing section/.test(i)));

// Parser tolerates code fences
assert.equal(parseDraft('```json\n{"title":"t","summary":"s","body_markdown":"b"}\n```').title, 't');
assert.throws(() => parseDraft('{"title":"t"}'), /summary/);
console.log('digest tests pass');
