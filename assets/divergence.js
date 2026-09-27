// Market Data Insider — Settlement Divergence Engine
// Pure functions, no DOM. Importable in Node (tests) and browser (UI).

// --- Seeded RNG: mulberry32 ---
export function makeSeededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Divergence presets (illustrative assumptions, not measured rates) ---
export const DIVERGENCE_PRESETS = {
  economic_data:   { label: 'Economic data (e.g. FOMC, CPI)',  q: 0.02 },
  election:        { label: 'Election',                         q: 0.08 },
  government_action: { label: 'Gov\'t action (e.g. shutdown)', q: 0.12 },
  sports:          { label: 'Sports',                           q: 0.05 },
  entertainment:   { label: 'Entertainment',                    q: 0.18 },
};

// --- Core simulation ---
// config = {
//   p: number,              // true outcome probability (YES wins)
//   legs: [{
//     venue: string,
//     side: 'YES'|'NO',
//     entry: number,        // $ per contract
//     contracts: number,
//     q: number,            // divergence probability for this venue
//     mode: 'opposite'|'last_traded',
//     ltpMin: number,       // only for last_traded
//     ltpMax: number,
//   }],
//   n: number,              // simulation count
//   seed: number,
// }
// returns Float64Array of per-trial P&L totals
export function runSimulation(config) {
  const { p, legs, n, seed } = config;
  const rng = makeSeededRng(seed);
  const results = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    // Draw real-world outcome
    const trueYes = rng() < p;

    let trialPnl = 0;
    for (const leg of legs) {
      // Draw divergence
      const diverges = rng() < leg.q;

      let settlement;
      if (!diverges) {
        settlement = trueYes ? 1.0 : 0.0;
      } else if (leg.mode === 'opposite') {
        settlement = trueYes ? 0.0 : 1.0;
      } else {
        // last_traded: draw uniformly from [ltpMin, ltpMax]
        settlement = leg.ltpMin + rng() * (leg.ltpMax - leg.ltpMin);
      }

      // P&L: entry is always the price paid for the contract held (YES or NO).
      // A YES contract pays `settlement`; a NO contract pays `1 - settlement`.
      const settlementValue = leg.side === 'YES' ? settlement : 1.0 - settlement;
      trialPnl += (settlementValue - leg.entry) * leg.contracts;
    }
    results[i] = trialPnl;
  }
  return results;
}

// --- Stats ---
// Input: Float64Array of P&L values
// Returns: { mean, pLoss, var95, cvar95 }
//   var95:  95% VaR — the 5th-percentile P&L (negative = loss)
//   cvar95: 95% CVaR — mean of all P&L at or below var95
export function computeStats(pnls) {
  const n = pnls.length;
  const sorted = Float64Array.from(pnls).sort();

  let sum = 0;
  let lossCount = 0;
  for (let i = 0; i < n; i++) {
    sum += sorted[i];
    if (sorted[i] < 0) lossCount++;
  }
  const mean = sum / n;
  const pLoss = lossCount / n;

  // 5th percentile index (floor so we're conservative)
  const idx5 = Math.floor(n * 0.05);
  const var95 = sorted[idx5];

  // CVaR: mean of the worst idx5+1 outcomes
  let tailSum = 0;
  const tailN = idx5 + 1;
  for (let i = 0; i <= idx5; i++) tailSum += sorted[i];
  const cvar95 = tailN > 0 ? tailSum / tailN : var95;

  return { mean, pLoss, var95, cvar95 };
}

// --- THE MATRIX: CVaR grid across p x q ---
// pGrid: array of p values (e.g. [0.1,0.2,...,0.9])
// qGrid: array of q values (e.g. [0,0.02,...,0.20])
// baseConfig: like runSimulation config but p and per-leg q will be overridden
// Returns { pGrid, qGrid, cells: 2D array [pIdx][qIdx] of cvar95 }
export function buildMatrix(baseConfig, pGrid, qGrid) {
  const matrixN = 1000;
  const cells = [];
  for (let pi = 0; pi < pGrid.length; pi++) {
    const row = [];
    for (let qi = 0; qi < qGrid.length; qi++) {
      const q = qGrid[qi];
      const cfg = {
        ...baseConfig,
        p: pGrid[pi],
        n: matrixN,
        // derive sub-seed from main seed + grid position
        seed: (baseConfig.seed ^ (pi * 97 + qi * 1009)) >>> 0,
        legs: baseConfig.legs.map((leg) => ({ ...leg, q })),
      };
      const pnls = runSimulation(cfg);
      const { cvar95 } = computeStats(pnls);
      row.push(cvar95);
    }
    cells.push(row);
  }
  return { pGrid, qGrid, cells };
}

// --- Histogram buckets ---
// Returns { bins: [{lo, hi, count}], min, max }
export function buildHistogram(pnls, nBins = 40) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < pnls.length; i++) {
    if (pnls[i] < min) min = pnls[i];
    if (pnls[i] > max) max = pnls[i];
  }
  if (min === max) { min -= 0.01; max += 0.01; }
  const width = (max - min) / nBins;
  const counts = new Int32Array(nBins);
  for (let i = 0; i < pnls.length; i++) {
    let b = Math.floor((pnls[i] - min) / width);
    if (b >= nBins) b = nBins - 1;
    counts[b]++;
  }
  const bins = [];
  for (let i = 0; i < nBins; i++) {
    bins.push({ lo: min + i * width, hi: min + (i + 1) * width, count: counts[i] });
  }
  return { bins, min, max };
}
