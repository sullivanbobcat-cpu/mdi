// Pulls USDA AgTransport (Socrata) barge data and writes normalized JSON to /data.
// Run: node scripts/refresh.mjs   (Node 18+; no dependencies)
// Optional: SOCRATA_APP_TOKEN env var raises rate limits.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = 'https://agtransport.usda.gov';
const DATASETS = {
  rates: 'deqi-uken',     // Downbound Grain Barge Rates (weekly, % of 1976 tariff)
  movements: 't8wc-fscq', // Weekly downbound grain barge movements (tons, by lock)
};
const YEARS_BACK = 6; // current year + 5 prior years for the seasonal average

// 1976 tariff benchmarks, $/ton. $/ton = pct_of_tariff / 100 * benchmark
export const LOCATIONS = [
  { key: 'twin',       label: 'Twin Cities',     benchmark: 6.19, group: 'Upper Mississippi', match: /twin/i },
  { key: 'mid',        label: 'Mid-Mississippi', benchmark: 5.32, group: 'Upper Mississippi', match: /mid/i },
  { key: 'illinois',   label: 'Illinois River',  benchmark: 4.64, group: 'Upper Mississippi', match: /ill/i },
  { key: 'stlouis',    label: 'St. Louis',       benchmark: 3.99, group: 'Upper Mississippi', match: /louis/i },
  { key: 'cincinnati', label: 'Cincinnati',      benchmark: 4.69, group: 'Ohio River',        match: /cinc/i },
  { key: 'lowerohio',  label: 'Lower Ohio',      benchmark: 4.46, group: 'Ohio River',        match: /lower.?ohio|\bloh\b/i },
  { key: 'cairo',      label: 'Cairo-Memphis',   benchmark: 3.14, group: 'Lower Mississippi', match: /cairo|memphis|car.?mem/i },
];

export const matchLocation = (s) => LOCATIONS.find((l) => l.match.test(String(s ?? '')));
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const day = (v) => String(v).slice(0, 10);
const round = (v, dp = 2) => (v === null || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, attempts = 4) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'marketdatainsider.com data refresh (+https://marketdatainsider.com)',
  };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  for (let i = 1; i <= attempts; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(90_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        const err = new Error(`HTTP ${res.status} for ${url}\n${body}`);
        err.fatal = true;
        throw err;
      }
      const data = await res.json();
      console.log(`  ok ${res.status} ${Date.now() - t0}ms ${url.replace(BASE, '')}`);
      return data;
    } catch (e) {
      const why = [e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(' | ');
      if (e.fatal || i === attempts) throw new Error(`Request failed after ${i} attempt(s): ${url}\n  ${why}`);
      console.warn(`  retry ${i}/${attempts - 1} in ${2 ** i}s: ${why}`);
      await sleep(2000 * 2 ** (i - 1));
    }
  }
}

// Infer column types from real rows. USDA's /api/views metadata can come back with no
// columns, so the data itself is the source of truth.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
export function inferSchema(rows) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !k.startsWith(':'));
  return keys.map((field) => {
    const vals = rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined && v !== '');
    let type = 'text';
    if (vals.length && vals.every((v) => typeof v === 'string' && ISO_DATE.test(v))) type = 'calendar_date';
    else if (vals.length && vals.every((v) => typeof v !== 'object' && v !== '' && Number.isFinite(Number(v)))) type = 'number';
    return { field, name: field.replace(/_/g, ' '), type };
  });
}

export async function getSchema(id) {
  const sample = await getJSON(`${BASE}/resource/${id}.json?$limit=1000`);
  if (!Array.isArray(sample) || !sample.length) {
    throw new Error(`Dataset ${id} returned no rows from /resource/${id}.json. The ID may point to a chart or filtered view, not the base table.`);
  }
  const schema = inferSchema(sample);
  if (!schema.length) throw new Error(`Dataset ${id} returns rows with no fields. It is a chart or view, not a data table. Find the base dataset ID.`);
  // Use the portal's display names when the metadata endpoint provides them.
  try {
    const view = await getJSON(`${BASE}/api/views/${id}.json`, 1);
    for (const c of view.columns || []) {
      const hit = schema.find((x) => x.field === c.fieldName);
      if (hit && c.name) hit.name = c.name;
    }
  } catch { /* names are optional */ }
  console.log(`  ${id} columns: ${schema.map((c) => `${c.field}(${c.type})`).join(', ')}`);
  console.log(`  ${id} sample row: ${JSON.stringify(sample[0])}`);
  return schema;
}

async function getRows(id, dateField, since) {
  const rows = [];
  const pageSize = 5000;
  for (let offset = 0; ; offset += pageSize) {
    const q = new URLSearchParams({
      $where: `${dateField} >= '${since}'`,
      $order: `${dateField} ASC`,
      $limit: String(pageSize),
      $offset: String(offset),
    });
    const page = await getJSON(`${BASE}/resource/${id}.json?${q}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const dateColumn = (schema) => {
  const col = schema.find((c) => c.type === 'calendar_date');
  if (!col) throw new Error(`No date column found. Schema: ${JSON.stringify(schema)}`);
  return col.field;
};

// Handles either shape: long (date, location, rate) or wide (date, one column per location).
export function normalizeRates(schema, rows) {
  const dateField = dateColumn(schema);
  const numeric = schema.filter((c) => c.type === 'number');
  const series = Object.fromEntries(LOCATIONS.map((l) => [l.key, []]));

  const wideCols = numeric
    .map((c) => ({ col: c, loc: matchLocation(c.name) || matchLocation(c.field) }))
    .filter((x) => x.loc);
  const isWide = new Set(wideCols.map((x) => x.loc.key)).size >= 3;

  const push = (loc, date, pct) => {
    if (pct === null || Number.isNaN(pct)) return;
    series[loc.key].push([date, pct]);
  };

  if (isWide) {
    for (const r of rows) for (const { col, loc } of wideCols) push(loc, day(r[dateField]), num(r[col.field]));
  } else {
    const text = schema.filter((c) => c.type === 'text');
    const locField = text
      .map((c) => ({ field: c.field, hits: new Set(rows.map((r) => matchLocation(r[c.field])?.key).filter(Boolean)).size }))
      .sort((a, b) => b.hits - a.hits)[0];
    if (!locField || locField.hits < 3) throw new Error(`Can't find a location column. Schema: ${JSON.stringify(schema)}`);
    const rateCol =
      numeric.find((c) => /tariff|percent|pct/i.test(c.name) && !/ton|\$/.test(c.name)) ||
      numeric.find((c) => /rate/i.test(c.name) && !/ton|\$/.test(c.name)) ||
      numeric[0];
    if (!rateCol) throw new Error(`No numeric rate column. Schema: ${JSON.stringify(schema)}`);
    for (const r of rows) {
      const loc = matchLocation(r[locField.field]);
      if (loc) push(loc, day(r[dateField]), num(r[rateCol.field]));
    }
  }

  // Guard: percent-of-tariff values sit roughly in the 100–1500 range. A low median means
  // we grabbed a $/ton column by mistake — fail loudly instead of publishing wrong numbers.
  const all = Object.values(series).flat().map((p) => p[1]);
  if (!all.length) throw new Error('Rates dataset returned no usable rows.');
  if (median(all) < 60) throw new Error(`Median rate ${median(all)} looks like $/ton, not % of tariff. Check column mapping.`);

  const out = {};
  for (const loc of LOCATIONS) {
    // Average duplicates within the same date, then convert.
    const byDate = new Map();
    for (const [d, pct] of series[loc.key]) byDate.set(d, [...(byDate.get(d) || []), pct]);
    out[loc.key] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => {
        const pct = v.reduce((s, x) => s + x, 0) / v.length;
        return [d, round(pct, 1), round((pct / 100) * loc.benchmark)];
      });
  }
  return out;
}

export function normalizeMovements(schema, rows) {
  const dateField = dateColumn(schema);
  const numeric = schema.filter((c) => c.type === 'number');
  const tonsCol = numeric.find((c) => /ton/i.test(c.name)) || numeric[0];
  if (!tonsCol) throw new Error(`No tonnage column. Schema: ${JSON.stringify(schema)}`);
  const lockCol = schema
    .filter((c) => c.type === 'text')
    .map((c) => ({ field: c.field, hits: rows.filter((r) => /lock|olmste/i.test(r[c.field] ?? '')).length }))
    .sort((a, b) => b.hits - a.hits)[0];
  if (!lockCol || !lockCol.hits) throw new Error(`No lock column. Schema: ${JSON.stringify(schema)}`);

  const weeks = new Map();
  const locks = new Set();
  for (const r of rows) {
    const d = day(r[dateField]);
    const lock = String(r[lockCol.field]).trim();
    const tons = num(r[tonsCol.field]);
    if (tons === null || Number.isNaN(tons)) continue;
    locks.add(lock);
    const w = weeks.get(d) || {};
    w[lock] = (w[lock] || 0) + tons;
    weeks.set(d, w);
  }
  return {
    locks: [...locks].sort(),
    weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, byLock]) => ({ d, byLock })),
  };
}

async function main() {
  const since = `${new Date().getUTCFullYear() - YEARS_BACK + 1}-01-01T00:00:00`;
  const updated = new Date().toISOString();
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  const write = (name, obj) => writeFile(new URL(`../data/${name}`, import.meta.url), JSON.stringify(obj));

  console.log(`Pulling USDA AgTransport data since ${since.slice(0, 10)}`);
  const rSchema = await getSchema(DATASETS.rates);
  await write('_schema.json', { rates: rSchema });

  const rRows = await getRows(DATASETS.rates, dateColumn(rSchema), since);
  const series = normalizeRates(rSchema, rRows);
  await write('rates.json', {
    updated,
    source: `${BASE}/d/${DATASETS.rates}`,
    locations: LOCATIONS.map(({ key, label, benchmark, group }) => ({ key, label, benchmark, group })),
    series, // key -> [[date, pct_of_tariff, usd_per_ton], ...]
  });

  const counts = Object.entries(series).map(([k, v]) => `${k}:${v.length}`).join(' ');
  console.log(`rates rows=${rRows.length} (${counts}) -> data/rates.json`);

  // Lock movements are optional: a failure here must not block the rates page.
  try {
    const mSchema = await getSchema(DATASETS.movements);
    const mRows = await getRows(DATASETS.movements, dateColumn(mSchema), since);
    await write('movements.json', { updated, source: `${BASE}/d/${DATASETS.movements}`, ...normalizeMovements(mSchema, mRows) });
    console.log(`movement rows=${mRows.length} -> data/movements.json`);
  } catch (e) {
    console.warn(`\nWARNING: skipped lock movements (rates were still written)\n${e.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nREFRESH FAILED\n${e.message}`);
    if (e.cause) console.error('cause:', e.cause);
    process.exit(1);
  });
}
