// Shared helpers for Market Data Insider pages.
window.MDI = (() => {
  const DAY = 864e5;
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const narrow = window.matchMedia('(max-width: 40rem)').matches;

  const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
    new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  const fixed = (v, dp = 1) => (v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const signed = (v, dp = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fixed(Math.abs(v), dp)}`);
  const dirClass = (v, eps = 1e-9) => (v == null || Math.abs(v) < eps ? 'flat' : v > 0 ? 'up' : 'down');

  function isoWeek(dstr) {
    const t = new Date(dstr.slice(0, 10) + 'T00:00:00Z');
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / DAY + 1) / 7) };
  }

  async function load(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url} returned ${r.status}`);
    return r.json();
  }

  // points: [[date, value], ...] -> { year: { week: value } }
  function byYearWeek(points) {
    const m = {};
    for (const [d, v] of points) {
      if (v == null) continue;
      const { year, week } = isoWeek(d);
      (m[year] ||= {})[week] = v;
    }
    return m;
  }

  // Stats for one ISO week across the five years before curYear.
  function fiveYear(m, curYear, week) {
    const vals = [];
    for (let y = curYear - 5; y < curYear; y++) {
      const v = m[y]?.[week];
      if (v != null) vals.push(v);
    }
    if (vals.length < 2) return null;
    return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
  }

  function chartDefaults() {
    Chart.defaults.font.family = "'Barlow', system-ui, sans-serif";
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--rule');
  }

  function showError(message) {
    const main = $('main');
    if (main) main.hidden = true;
    const box = $('error');
    box.hidden = false;
    box.textContent = message;
  }

  return { DAY, $, css, narrow, fmtDate, fixed, signed, dirClass, isoWeek, load, byYearWeek, fiveYear, chartDefaults, showError };
})();
