# Solar Dimension · Kit builder

Pick the appliances that must stay on during an outage, set how long the backup must last, and get the inverter, the battery bank (12 / 24 / 36 / 48 V) and the DC cabling you need.

## Develop

    npm install
    npm run dev          # http://localhost:3000
    npm run typecheck
    npm run test         # unit tests (Vitest)
    npm run test:coverage
    npm run e2e          # Playwright (builds and serves the app itself)

## Deploy (Vercel)

1. Push to GitHub.
2. In Vercel choose **Add New → Project**, import the repo, keep the detected **TanStack Start** framework settings (`vercel.json` makes detection explicit).
3. Deploy. Nitro's output becomes Vercel Functions plus static assets.

## Sizing assumptions

Inverter efficiency 90%, inverter headroom 25%, surge = running load + the largest single motor start-up delta, LiFePO₄ depth of discharge 85% (AGM 50%), 1,100 W per ton of cooling, conventional compressors 3× start surge (inverter compressors 1.3×), copper cable ampacity at 105 °C insulation, 3% maximum voltage drop, class T fuse ≥ 1.1× current. Verify conductor sizes against local code before building anything.
