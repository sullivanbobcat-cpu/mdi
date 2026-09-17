// Turns the site's data files into a compact, pre-rounded FACTS object.
// The AI digest may only use numbers that appear here.
const DAY = 864e5;
const round = (v, dp) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

export function isoWeek(dstr) {
  const t = new Date(dstr.slice(0, 10) + 'T00:00:00Z');
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / DAY + 1) / 7) };
}

// Average of the same ISO week across the five calendar years before the latest point's year.
export function fiveYearAvg(points, date) {
  const { year, week } = isoWeek(date);
  const vals = points
    .filter(([d]) => { const w = isoWeek(d); return w.week === week && w.year >= year - 5 && w.year < year; })
    .map(([, v]) => v);
  return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Weekly series stats. scale converts units (e.g. thousand barrels -> million barrels).
export function weekly(points, { scale = 1, dp = 1, chgScale = scale, chgDp = dp } = {}) {
  if (!points?.length) return null;
  const [d, v] = points[points.length - 1];
  const prev = points[points.length - 2];
  const gap = prev ? (Date.parse(d) - Date.parse(prev[0])) / DAY : Infinity;
  const avg = fiveYearAvg(points, d);
  const out = { date: d, value: round(v * scale, dp) };
  if (prev && gap <= 10) {
    out.weeklyChange = round((v - prev[1]) * chgScale, chgDp);
    out.weeklyChangePct = round(((v - prev[1]) / prev[1]) * 100, 1);
  }
  if (avg != null) {
    out.fiveYearAvgSameWeek = round(avg * scale, dp);
    out.vsFiveYearAvg = round((v - avg) * scale, dp);
    out.vsFiveYearAvgPct = round(((v - avg) / avg) * 100, 1);
  }
  return out;
}

// Daily price stats: latest, and change vs. roughly one week earlier.
export function daily(points, dp = 2) {
  if (!points?.length) return null;
  const [d, v] = points[points.length - 1];
  const target = Date.parse(d) - 7 * DAY;
  const past = [...points].reverse().find(([pd]) => Date.parse(pd) <= target);
  const out = { date: d, value: round(v, dp) };
  if (past) {
    out.weekAgoDate = past[0];
    out.weekAgoValue = round(past[1], dp);
    out.weeklyChange = round(v - past[1], dp);
    out.weeklyChangePct = round(((v - past[1]) / past[1]) * 100, 1);
  }
  return out;
}

export function buildFacts({ rates, energy }) {
  const facts = { notes: 'All values pre-rounded. Dates are the report or quote dates. Weekly changes compare with the prior report. Five-year averages use the same ISO week in the five prior calendar years.' };

  if (rates?.series) {
    const all = Object.values(rates.series).flat().map((p) => p[0]).sort();
    const asOf = all[all.length - 1];
    const origins = {};
    for (const loc of rates.locations) {
      const s = rates.series[loc.key] || [];
      const last = s[s.length - 1];
      if (!last || (Date.parse(asOf) - Date.parse(last[0])) / DAY > 21) {
        origins[loc.label] = { status: 'no recent quote (seasonal closure likely)' };
        continue;
      }
      const w = weekly(s.map(([d, , usd]) => [d, usd]), { dp: 2 });
      origins[loc.label] = { ...w, percentOfTariff: round(last[1], 0), unit: '$/ton to the Gulf' };
    }
    facts.grainBargeFreight = { source: 'USDA AMS downbound grain barge rates', weekOf: asOf, origins };
  }

  const e = energy?.series;
  if (e) {
    const s = (k) => e[k]?.points;
    const out = { source: 'U.S. Energy Information Administration' };
    const add = (key, val) => { if (val) out[key] = val; };
    add('commercialCrudeStocks_millionBbl', weekly(s('crude'), { scale: 1 / 1000, dp: 1 }));
    add('cushingStocks_millionBbl', weekly(s('cushing'), { scale: 1 / 1000, dp: 1 }));
    add('gasolineStocks_millionBbl', weekly(s('gasoline'), { scale: 1 / 1000, dp: 1 }));
    add('distillateStocks_millionBbl', weekly(s('distillate'), { scale: 1 / 1000, dp: 1 }));
    add('refineryUtilization_percent', weekly(s('refutil'), { dp: 1 }));
    add('crudeProduction_millionBblPerDay', weekly(s('production'), { scale: 1 / 1000, dp: 2, chgScale: 1, chgDp: 0 }));
    if (out.crudeProduction_millionBblPerDay?.weeklyChange != null) out.crudeProduction_millionBblPerDay.weeklyChangeUnit = 'thousand b/d';
    add('naturalGasStorage_Bcf', weekly(s('gas'), { dp: 0 }));
    add('dieselRetail_dollarsPerGallon', weekly(s('diesel'), { dp: 3 }));
    add('wtiSpot_dollarsPerBbl', daily(s('wti')));
    add('brentSpot_dollarsPerBbl', daily(s('brent')));
    add('henryHubSpot_dollarsPerMMBtu', daily(s('henryhub')));
    const spotNote = 'EIA daily physical spot assessment. Can differ sharply from the front-month futures prices quoted in the news; if you mention it, call it the spot price.';
    for (const k of ['wtiSpot_dollarsPerBbl', 'brentSpot_dollarsPerBbl', 'henryHubSpot_dollarsPerMMBtu']) if (out[k]) out[k].note = spotNote;
    facts.energy = out;
  }
  return facts;
}

// Every number in FACTS, for validating drafted text.
export function allowedNumbers(facts) {
  const nums = new Set();
  const walk = (x) => {
    if (typeof x === 'number') nums.add(Math.abs(x));
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(facts);
  return [...nums];
}
