// Drafts the weekly AI-assisted digest from the site's own data.
// Run: npm run digest   (needs ANTHROPIC_API_KEY in .env or the environment)
// Output: drafts/YYYY-MM-DD-weekly-digest.md (gitignored). Review, edit, then move to notes/ to publish.
import './env.mjs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildFacts, allowedNumbers } from './facts.mjs';

const MODEL = process.env.DIGEST_MODEL || 'claude-sonnet-5';
export const WARNING_MARKER = 'UNVERIFIED-CONTENT';

const SYSTEM = `You draft a weekly commodity fundamentals note for marketdatainsider.com, a personal site built from public USDA and EIA data.

Hard rules:
1. Use only numbers that appear in FACTS. You may round them. Do not introduce any other figure, price, forecast, date, or statistic, and do not do new arithmetic.
2. Never give trading advice. Do not tell readers to buy, sell, go long or short, enter, exit, or hold anything. No price targets, no stop levels, no price predictions.
3. "What to watch" items are conditional statements about upcoming data, e.g. "If injections keep running below the five-year pace, the storage surplus would narrow."
4. Do not mention any company, employer, or non-public information. Do not claim causes you cannot support from FACTS; phrase drivers as possibilities ("consistent with", "may reflect").
5. Skip any market that is missing from FACTS. Do not mention the data pipeline or that you are an AI.
6. 250 to 400 words. Plain, precise English. Use the units given in FACTS.

Respond with JSON only, no code fences:
{"title": "<under 70 characters, specific>", "summary": "<one or two sentences>", "body_markdown": "<markdown with exactly these sections: ## What moved, ## The fundamental read, ## What to watch>"}`;

const ADVICE = /\b(buy|buying|sell|selling|go long|go short|get long|get short|going long|going short|stop[- ]loss|price target|target price|entry point|take profits?|position yourself)\b/i;

// Strip things that legitimately contain digits (dates, years, fixed names) before checking numbers.
function stripKnown(text) {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\bLower 48\b|\bfive-year\b|\b5-year\b|\b1976\b|\bLocks? (and Dam )?\d+\b|\bWeek \d+\b/gi, ' ');
}

export function validateDraft(draft, facts) {
  const issues = [];
  const text = `${draft.title}\n${draft.summary}\n${draft.body_markdown}`;
  const advice = text.match(ADVICE);
  if (advice) issues.push(`trading-advice language: "${advice[0]}"`);
  for (const h of ['## What moved', '## The fundamental read', '## What to watch']) {
    if (!draft.body_markdown.includes(h)) issues.push(`missing section "${h}"`);
  }
  const allowed = allowedNumbers(facts);
  const bad = new Set();
  for (const m of stripKnown(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,(?=\d{3})/g, '').replace(/,$/, '');
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const decimals = (raw.split('.')[1] || '').length;
    const tol = 0.5 * 10 ** -decimals + 1e-9;
    if (!allowed.some((a) => Math.abs(a - n) <= tol)) bad.add(m[0]);
  }
  if (bad.size) issues.push(`numbers not found in FACTS: ${[...bad].join(', ')}`);
  return issues;
}

async function callClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: SYSTEM, messages }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  return (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

export function parseDraft(text) {
  const clean = text.replace(/```(?:json)?/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  const d = JSON.parse(clean.slice(start, end + 1));
  for (const k of ['title', 'summary', 'body_markdown']) {
    if (typeof d[k] !== 'string' || !d[k].trim()) throw new Error(`draft is missing "${k}"`);
  }
  return d;
}

const exists = (p) => access(p).then(() => true, () => false);
const yaml = (s) => `"${s.replace(/"/g, "'")}"`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set. Add it to the .env file in the repo root.');
  const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
  const rates = await load('rates.json').catch(() => null);
  const energy = await load('energy.json').catch(() => null);
  if (!rates && !energy) throw new Error('No data files found. Run the refresh scripts (or git pull) first.');

  const facts = buildFacts({ rates, energy });
  const today = new Date().toISOString().slice(0, 10);
  const dir = new URL('../drafts/', import.meta.url);
  const file = new URL(`${today}-weekly-digest.md`, dir);
  if ((await exists(file)) && !process.argv.includes('--force')) {
    throw new Error(`drafts/${today}-weekly-digest.md already exists. Use "npm run digest -- --force" to overwrite it.`);
  }

  const markets = [facts.grainBargeFreight && 'Grain freight', facts.energy && 'Energy'].filter(Boolean);
  console.log(`Drafting with ${MODEL} from: ${markets.join(', ')}`);
  const messages = [{ role: 'user', content: `FACTS:\n${JSON.stringify(facts, null, 2)}` }];
  let text = await callClaude(messages);
  let draft = parseDraft(text);
  let issues = validateDraft(draft, facts);

  if (issues.length) {
    console.warn(`  first draft failed checks, retrying once:\n  - ${issues.join('\n  - ')}`);
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: `Your draft broke these rules:\n- ${issues.join('\n- ')}\nRewrite it to fix every issue. Same JSON format.` });
    text = await callClaude(messages);
    draft = parseDraft(text);
    issues = validateDraft(draft, facts);
  }

  const warning = issues.length
    ? `> **${WARNING_MARKER}: fix before publishing.** ${issues.join('; ')}. The site build refuses to publish a note that still contains this block.\n\n`
    : '';
  const md = `---
title: ${yaml(draft.title)}
date: ${today}
summary: ${yaml(draft.summary)}
markets: ${markets.join(', ')}
draft: true
---

${warning}${draft.body_markdown.trim()}

*Drafted with AI from this site's data, then reviewed and edited before publishing.*
`;
  await mkdir(dir, { recursive: true });
  await writeFile(file, md);
  await writeFile(new URL(`${today}-facts.json`, dir), JSON.stringify(facts, null, 2));
  console.log(`Wrote drafts/${today}-weekly-digest.md${issues.length ? ` WITH ${issues.length} UNRESOLVED ISSUE(S)` : ' (all checks passed)'}`);
  console.log(`Facts used: drafts/${today}-facts.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\nDIGEST FAILED\n${e.message}`); process.exit(1); });
}
