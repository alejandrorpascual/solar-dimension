# QA v1 · #204 · head f98b1f3

- Verify: `npm ci --silent && npm run typecheck && npm run test:coverage && npm run build` — 2154/2154, 90.36% lines, build ok (first run: 3 engine tests in untouched files timed out at load avg 71; they pass alone and on the rerun).
- New e2e: `e2e/kit-hold.spec.ts` (desktop) — 2/2 pass.
- Red check: with `getQuoteJobs` put back on the old rule (`result.empty ? … : kitNeeds(result)`), the missing-kit test fails with `Received: "Verdict ready · SolarTec Caribe · $6,480"`, the bug the issue names. Restored; green.
- Related e2e: `kit-hold`, `quote-tray`, `quotes` specs on desktop — 38 passed, 2 skipped.
- Screenshots: desktop 1920×1080, tablet 1024×768, mobile 375×667, with crops of the changed card.
- Before shots in `before/`: base `75840c1` with the same steps shows "Verdict ready · SolarTec Caribe · $6,480" on the kit's quotes card.
