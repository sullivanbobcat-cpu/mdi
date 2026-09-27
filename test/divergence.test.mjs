import assert from 'node:assert/strict';
import { runSimulation, computeStats, makeSeededRng, buildHistogram } from '../assets/divergence.js';

// --- 1. Hedge invariant ---
// Two legs: YES at $0.49 + NO at $0.49, q=0 on both, 1 contract each.
// Total cost: 0.49 + (1-0.49) = 0.49 + 0.51 = $1.00. Wait — cost is entry per leg.
// YES leg cost: $0.49. NO leg cost: $0.49 (entry on NO side).
// At settlement: YES leg pays settlement, NO pays (1 - settlement).
// Sum is always $1.00 regardless of outcome.
// P&L per leg: YES: (settlement - 0.49), NO: ((1-settlement) - 0.49)
// Total P&L = settlement - 0.49 + 1 - settlement - 0.49 = 1 - 0.98 = +0.02 always.
{
  const cfg = {
    p: 0.5,
    legs: [
      { venue: 'A', side: 'YES', entry: 0.49, contracts: 1, q: 0, mode: 'opposite', ltpMin: 0, ltpMax: 1 },
      { venue: 'B', side: 'NO',  entry: 0.49, contracts: 1, q: 0, mode: 'opposite', ltpMin: 0, ltpMax: 1 },
    ],
    n: 1000,
    seed: 42,
  };
  const pnls = runSimulation(cfg);
  for (let i = 0; i < pnls.length; i++) {
    assert.ok(
      Math.abs(pnls[i] - 0.02) < 1e-9,
      `hedge invariant failed at trial ${i}: got ${pnls[i]}, expected 0.02`
    );
  }
  console.log('  hedge invariant: pass');
}

// --- 2. Seed reproducibility ---
{
  const cfg = {
    p: 0.6,
    legs: [
      { venue: 'X', side: 'YES', entry: 0.55, contracts: 10, q: 0.1, mode: 'opposite', ltpMin: 0, ltpMax: 1 },
    ],
    n: 500,
    seed: 9999,
  };
  const r1 = runSimulation(cfg);
  const r2 = runSimulation(cfg);
  assert.equal(r1.length, r2.length);
  for (let i = 0; i < r1.length; i++) {
    assert.equal(r1[i], r2[i], `seed mismatch at index ${i}`);
  }
  console.log('  seed reproducibility: pass');
}

// --- 3. Cardi B replay ---
// Forced divergence: Kalshi YES, q=1, mode=last_traded, LTP fixed at $0.26 (ltpMin=ltpMax=0.26)
// Polymarket NO, q=0 (no divergence). p=1 so YES wins in reality.
//
// Entry prices (illustrative per spec):
//   Kalshi YES: paid $0.20. Settlement = $0.26 (forced LTP). P&L = (0.26-0.20)*100 = +$6.00
//   Polymarket NO: paid $0.78. YES wins → NO pays (1-1.00)=$0.00. P&L = (0.00-0.78)*100 = -$78.00
//   Total = -$72.00
//
// Divergence gap on Kalshi: holder received $0.26 instead of $1.00 → $0.74*100 = $74 shortfall.
// $74 shortfall / $100 full payout = 74% loss relative to full payout (the ~73% figure in the spec).
{
  const cfg = {
    p: 1.0, // always YES in reality
    legs: [
      { venue: 'Kalshi',     side: 'YES', entry: 0.20, contracts: 100, q: 1.0, mode: 'last_traded', ltpMin: 0.26, ltpMax: 0.26 },
      { venue: 'Polymarket', side: 'NO',  entry: 0.78, contracts: 100, q: 0.0, mode: 'opposite',    ltpMin: 0,    ltpMax: 1 },
    ],
    n: 100,
    seed: 1,
  };
  const pnls = runSimulation(cfg);
  // All trials deterministic: Kalshi +$6, PM NO -$78, total -$72
  for (let i = 0; i < pnls.length; i++) {
    assert.ok(
      Math.abs(pnls[i] - (-72.0)) < 1e-9,
      `Cardi B replay failed at trial ${i}: got ${pnls[i]}, expected -72.00`
    );
  }
  // Verify Kalshi divergence gap: $0.74 * 100 = $74 shortfall vs full $1.00 payout (74%)
  const kalshiDivergenceGapPct = ((1.00 - 0.26) / 1.00) * 100;
  assert.ok(Math.abs(kalshiDivergenceGapPct - 74) < 1e-9, `expected 74% gap, got ${kalshiDivergenceGapPct}`);
  console.log('  Cardi B replay: pass (net P&L = -$72.00; Kalshi divergence gap = 74% of full payout)');
}

// --- 4. CVaR >= VaR (in loss terms: cvar95 <= var95 since both are negative) ---
{
  const cfg = {
    p: 0.45,
    legs: [
      { venue: 'A', side: 'YES', entry: 0.60, contracts: 50, q: 0.15, mode: 'opposite', ltpMin: 0, ltpMax: 1 },
      { venue: 'B', side: 'YES', entry: 0.40, contracts: 30, q: 0.08, mode: 'last_traded', ltpMin: 0.1, ltpMax: 0.4 },
    ],
    n: 10000,
    seed: 777,
  };
  const pnls = runSimulation(cfg);
  const { var95, cvar95 } = computeStats(pnls);
  assert.ok(
    cvar95 <= var95,
    `CVaR should be <= VaR (worse tail): cvar95=${cvar95}, var95=${var95}`
  );
  console.log(`  CVaR >= VaR: pass (var95=${var95.toFixed(4)}, cvar95=${cvar95.toFixed(4)})`);
}

// --- 5. buildHistogram basic sanity ---
{
  const pnls = new Float64Array([1, 2, 3, 4, 5]);
  const { bins, min, max } = buildHistogram(pnls, 5);
  assert.equal(bins.length, 5);
  const total = bins.reduce((s, b) => s + b.count, 0);
  assert.equal(total, 5, 'histogram should contain all values');
  console.log('  histogram sanity: pass');
}

// --- 6. computeStats basic sanity ---
{
  // Uniform known array: [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5] (10 items)
  const pnls = new Float64Array([-4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  const { mean, pLoss, var95, cvar95 } = computeStats(pnls);
  assert.ok(Math.abs(mean - 0.5) < 1e-9, `mean expected 0.5, got ${mean}`);
  assert.equal(pLoss, 0.4); // 4 of 10 are negative
  // 5th percentile: floor(10 * 0.05) = 0 → sorted[0] = -4
  assert.equal(var95, -4);
  // CVaR: mean of sorted[0..0] = -4
  assert.equal(cvar95, -4);
  console.log('  computeStats sanity: pass');
}

console.log('all divergence tests pass');
