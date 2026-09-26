# marketdatainsider.com

Weekly commodity fundamentals, built from public data.

## Pages
- `/` home: this week's headline numbers and the latest note
- `/grain-freight/` Mississippi River System barge rates (USDA AgTransport)
- `/energy/` crude oil and natural gas inventories, spot prices (EIA)
- `/notes/` weekly write-ups

## How it runs
Static HTML + Chart.js on Netlify. A GitHub Action (Tue–Fri) refreshes `data/rates.json` and `data/energy.json` and commits them. Netlify's build step compiles `notes/*.md` into `data/notes.json` on every deploy.

## Commands
- `npm test`: unit tests
- `npm run refresh`: USDA barge rates
- `EIA_API_KEY=... npm run refresh:energy`: EIA energy data (skips if no key)
- `npm run notes`: compile notes locally
- `npm run serve`: preview at http://localhost:4321

## Weekly AI digest (local, private until you publish)
1. Copy `.env.example` to `.env` and add `ANTHROPIC_API_KEY` (and `EIA_API_KEY`). `.env` is never committed.
2. `git pull`, then `npm run digest`. It writes `drafts/YYYY-MM-DD-weekly-digest.md` plus the facts file it used. `drafts/` is never committed.
3. The script rejects any number not in the facts file and any trading-advice language, retries once, and flags anything left with an UNVERIFIED-CONTENT block. The site build refuses to publish a note containing that block.
4. Edit the draft, add your own read, move it into `notes/`, delete `draft: true`, commit, push.

## Writing a note
Copy `notes/_template.md` to `notes/YYYY-MM-DD-short-title.md`, fill it in, delete the `draft: true` line, commit and push. It's live after the deploy finishes.

## Secrets (GitHub → Settings → Secrets and variables → Actions)
- `EIA_API_KEY` (required for energy): free at https://www.eia.gov/opendata/register.php
- `SOCRATA_APP_TOKEN` (optional)

## Contact
<!-- TODO: replace placeholder with real brand email before publishing contact details anywhere -->
Brand email: hello@marketdatainsider.com

## Rules
Public data only. No exchange futures prices. Name every source. Personal project, not affiliated with any employer, not investment advice.
