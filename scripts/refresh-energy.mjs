// Pulls EIA weekly inventories, gas storage and spot prices; writes data/energy.json.
// Run: EIA_API_KEY=yourkey node scripts/refresh-energy.mjs   (Node 18+; no dependencies)
// Free key: https://www.eia.gov/opendata/register.php
import './env.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.eia.gov/v2/seriesid';
const YEARS_BACK = 6; // current year + 5 prior years for the seasonal range

// EIA series IDs (APIv1 IDs, served through APIv2's seriesid route).
export const SERIES = {
  crude:      { id: 'PET.WCESTUS1.W',              freq: 'weekly', unit: 'thousand barrels', label: 'U.S. commercial crude oil stocks (excl. SPR)', required: true },
  cushing:    { id: 'PET.W_EPC0_SAX_YCUOK_MBBL.W', freq: 'weekly', unit: 'thousand barrels', label: 'Cushing, OK crude oil stocks' },
  gasoline:   { id: 'PET.WGTSTUS1.W',              freq: 'weekly', unit: 'thousand barrels', label: 'U.S. total gasoline stocks' },
  distillate: { id: 'PET.WDISTUS1.W',              freq: 'weekly', unit: 'thousand barrels', label: 'U.S. distillate fuel oil stocks' },
  refutil:    { id: 'PET.WPULEUS3.W',              freq: 'weekly', unit: 'percent',          label: 'U.S. refinery utilization' },
  production: { id: 'PET.WCRFPUS2.W',              freq: 'weekly', unit: 'thousand b/d',     label: 'U.S. crude oil field production' },
  gas:        { id: 'NG.NW2_EPG0_SWO_R48_BCF.W',   freq: 'weekly', unit: 'Bcf',              label: 'Lower 48 working gas in underground storage', required: true },
  diesel:     { id: 'PET.EMD_EPD2D_PTE_NUS_DPG.W', freq: 'weekly', unit: '$/gal',            label: 'U.S. on-highway diesel retail price' },
  wti:        { id: 'PET.RWTC.D',                  freq: 'daily',  unit: '$/bbl',            label: 'WTI crude oil spot price, Cushing' },
  brent:      { id: 'PET.RBRTE.D',                 freq: 'daily',  unit: '$/bbl',            label: 'Brent crude oil spot price, Europe' },
  henryhub:   { id: 'NG.RNGWHHD.D',                freq: 'daily',  unit: '$/MMBtu',          label: 'Henry Hub natural gas spot price' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s).replace(/api_key=[^&\s]+/g, 'api_key=***');

// EIA rows -> sorted, de-duplicated [[YYYY-MM-DD, number], ...]
export function normalizeEIA(rows) {
  const byDate = new Map();
  for (const r of rows || []) {
    const d = String(r.period ?? '').slice(0, 10);
    const v = r.value === null || r.value === undefined || r.value === '' ? NaN : Number(r.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(v)) continue;
    byDate.set(d, v);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function fetchSeries(key, s, start) {
  const q = new URLSearchParams({ api_key: key, start, length: '5000' });
  q.append('sort[0][column]', 'period');
  q.append('sort[0][direction]', 'desc');
  const url = `${API}/${s.id}?${q}`;
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      let body;
      try { body = JSON.parse(text); } catch { throw Object.assign(new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 200)}`), { fatal: true }); }
      if (!res.ok || body.error) throw Object.assign(new Error(`HTTP ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`), { fatal: true });
      return body.response?.data ?? [];
    } catch (e) {
      const why = redact([e.message, e.cause?.code].filter(Boolean).join(' | '));
      if (e.fatal || i === 4) throw new Error(`${s.id}: ${why}`);
      console.warn(`  retry ${i}/3 ${s.id}: ${why}`);
      await sleep(2000 * 2 ** (i - 1));
    }
  }
}

async function main() {
  const key = process.env.EIA_API_KEY;
  if (!key) {
    console.warn('EIA_API_KEY is not set, skipping energy refresh. Get a free key at https://www.eia.gov/opendata/register.php');
    return;
  }

  const start = `${new Date().getUTCFullYear() - YEARS_BACK + 1}-01-01`;
  const now = Date.now();
  const out = { updated: new Date().toISOString(), source: 'U.S. Energy Information Administration (EIA) Open Data API v2', series: {} };
  const problems = [];

  console.log(`Pulling EIA series since ${start}`);
  for (const [name, s] of Object.entries(SERIES)) {
    try {
      const rows = await fetchSeries(key, s, start);
      const points = normalizeEIA(rows).filter(([d]) => d >= start);
      if (!points.length) throw new Error(`${s.id}: no data returned`);
      const [lastDate, lastVal] = points[points.length - 1];
      const ageDays = Math.round((now - Date.parse(lastDate)) / 864e5);
      const desc = rows[0]?.['series-description'] || rows[0]?.seriesDescription || '(no description in response)';
      console.log(`  ok ${name.padEnd(10)} ${String(points.length).padStart(5)} pts  latest ${lastDate} = ${lastVal}  [${desc}]`);
      const staleLimit = s.freq === 'daily' ? 10 : 21;
      if (ageDays > staleLimit) console.warn(`  WARNING ${name}: latest point is ${ageDays} days old`);
      out.series[name] = { id: s.id, label: s.label, unit: s.unit, freq: s.freq, points };
    } catch (e) {
      problems.push({ name, required: !!s.required, message: redact(e.message) });
      console.warn(`  FAILED ${name}: ${redact(e.message)}`);
    }
  }

  const fatal = problems.filter((p) => p.required);
  if (fatal.length) throw new Error(`Required series failed, energy.json not written:\n${fatal.map((p) => `  ${p.message}`).join('\n')}`);

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/energy.json', import.meta.url), JSON.stringify(out));
  console.log(`energy.json written with ${Object.keys(out.series).length}/${Object.keys(SERIES).length} series${problems.length ? ` (${problems.length} optional skipped)` : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nENERGY REFRESH FAILED\n${redact(e.message)}`);
    process.exit(1);
  });
}
