import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, '../data/event-contracts.json'), 'utf8');
const data = JSON.parse(raw);

// Top-level structure
assert.ok(data.meta, 'missing meta');
assert.match(data.meta.last_updated, /^\d{4}-\d{2}-\d{2}$/, 'meta.last_updated must be YYYY-MM-DD');
assert.ok(Array.isArray(data.contracts), 'contracts must be an array');
assert.equal(data.contracts.length, 3, 'expected 3 contracts');
assert.ok(data.case_study, 'missing case_study');

const VALID_RATINGS = new Set(['Low', 'Medium', 'High']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_CONTRACT_FIELDS = ['id', 'title', 'resolution_date', 'divergence_rating', 'divergence_scenario', 'venues'];
const VENUE_KEYS = ['kalshi', 'polymarket_us', 'polymarket_intl', 'cme'];
const REQUIRED_VENUE_FIELDS = ['contract_title', 'url', 'listing_entity', 'resolution_source',
  'resolution_trigger', 'delay_revision', 'ambiguity_cancellation', 'decision_path', 'last_verified'];

for (const contract of data.contracts) {
  // Required fields present
  for (const f of REQUIRED_CONTRACT_FIELDS) {
    assert.ok(contract[f] != null, `contract missing field: ${f} (id=${contract.id})`);
  }

  // resolution_date is YYYY-MM-DD
  assert.match(contract.resolution_date, DATE_RE, `${contract.id}: resolution_date must be YYYY-MM-DD`);

  // divergence_rating is Low, Medium, or High
  assert.ok(VALID_RATINGS.has(contract.divergence_rating),
    `${contract.id}: divergence_rating must be Low, Medium, or High (got: ${contract.divergence_rating})`);

  // divergence_scenario is a non-empty string
  assert.ok(typeof contract.divergence_scenario === 'string' && contract.divergence_scenario.length > 0,
    `${contract.id}: divergence_scenario must be a non-empty string`);

  // All four venue keys present
  for (const vk of VENUE_KEYS) {
    assert.ok(contract.venues[vk] != null, `${contract.id}: missing venue key: ${vk}`);
  }

  // For each listed venue: required fields, valid date, https URL
  for (const vk of VENUE_KEYS) {
    const venue = contract.venues[vk];
    if (venue.not_listed) continue;

    for (const f of REQUIRED_VENUE_FIELDS) {
      assert.ok(venue[f] != null, `${contract.id}/${vk}: missing venue field: ${f}`);
    }

    assert.ok(venue.url.startsWith('https://'),
      `${contract.id}/${vk}: url must start with https:// (got: ${venue.url})`);

    assert.match(venue.last_verified, DATE_RE,
      `${contract.id}/${vk}: last_verified must be YYYY-MM-DD`);
  }
}

// Case study structure
const cs = data.case_study;
assert.ok(cs.id, 'case_study missing id');
assert.ok(cs.title, 'case_study missing title');
assert.ok(cs.venues, 'case_study missing venues');
assert.ok(cs.illustrative_spread, 'case_study missing illustrative_spread');
assert.match(cs.last_verified, DATE_RE, 'case_study.last_verified must be YYYY-MM-DD');

// Illustrative spread sanity checks
const sp = cs.illustrative_spread;
assert.ok(typeof sp.settlement_gap_per_contract === 'number', 'settlement_gap_per_contract must be a number');
assert.ok(sp.settlement_gap_per_contract > 0, 'settlement_gap_per_contract must be positive');
assert.ok(sp.gap_as_pct_of_full_payout > 0 && sp.gap_as_pct_of_full_payout <= 100,
  'gap_as_pct_of_full_payout must be between 0 and 100');

console.log('all event-contracts tests pass');
