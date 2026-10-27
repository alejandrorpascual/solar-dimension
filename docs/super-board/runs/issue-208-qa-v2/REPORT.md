# #208 QA v2 at e437ee8

- Typecheck: green
- Unit (`npm run test:coverage`): 135 files, 2157 tests passed, 90.35% statements
- e2e `e2e/quotes.spec.ts` desktop: 38 passed (log: `e2e-desktop.log`, which also lists the 3 screenshot runs); the webServer runs `npm run build` first
- R2 unit `src/lib/quote-compare.test.ts:258`: red with the file record moved back after the skip, green restored
- New e2e `e2e/quotes.spec.ts:154` (three uploads, R2) and the help-text check at `:145` (R1): both red against the app at `5961627`, green at `e437ee8`
- Screenshots: verdict after one PDF uploaded twice under two names, at 1920x1080, 1024x768 and 375x667, plus crops of the duplicate card
