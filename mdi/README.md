# marketdatainsider.com

Weekly Mississippi River System grain barge freight, converted to $/ton, with seasonal context and lock traffic.

## Stack
Static HTML + Chart.js on Netlify. A GitHub Action pulls USDA AgTransport data (Tue–Fri) and commits JSON to `data/`; each commit redeploys the site.

## First run (do this before anything else)
1. `npm test` — normalizer unit tests.
2. `npm run refresh` — hits the live USDA API and writes `data/rates.json`, `data/movements.json`, `data/_schema.json`.
3. Open `data/_schema.json` and confirm the rate column is **percent of tariff** (values mostly 100–1500). The script throws if it isn't.
4. Spot-check one St. Louis week against the latest USDA Grain Transportation Report.
5. `npm run serve` and open http://localhost:4321.

## Datasets
- Rates: https://agtransport.usda.gov/d/deqi-uken
- Lock movements: https://agtransport.usda.gov/d/t8wc-fscq

## Conversion
$/ton = pct_of_tariff / 100 × benchmark. Benchmarks ($/ton): Twin Cities 6.19, Mid-Miss 5.32, Illinois 4.64, St. Louis 3.99, Cincinnati 4.69, Lower Ohio 4.46, Cairo-Memphis 3.14.
