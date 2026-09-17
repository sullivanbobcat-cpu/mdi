import assert from 'node:assert/strict';
import { parseNote } from '../scripts/build-notes.mjs';

const n = parseNote('2026-09-18-barge-rates.md', `---
title: Barge rates jump into harvest
date: 2026-09-18
summary: St. Louis freight up 16% on the week.
markets: Grain freight, Energy
---

Body **text**.`);
assert.equal(n.slug, '2026-09-18-barge-rates');
assert.equal(n.title, 'Barge rates jump into harvest');
assert.deepEqual(n.markets, ['Grain freight', 'Energy']);
assert.equal(n.body, 'Body **text**.');
assert.equal(n.draft, false);
assert.throws(() => parseNote('Bad Name.md', '---\ntitle: x\ndate: 2026-01-01\n---\n'), /lowercase/);
assert.throws(() => parseNote('a.md', '---\ntitle: x\ndate: Sept 1\n---\n'), /YYYY-MM-DD/);
assert.throws(() => parseNote('a.md', 'no front matter'), /front matter/);
console.log('notes tests pass');
