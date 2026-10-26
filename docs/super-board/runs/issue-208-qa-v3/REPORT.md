# #208 QA v3 at b4e1cc2

- Typecheck (app, e2e, scripts): green; red with the R3 fix undone
- Unit (`npm run test:coverage`): 138 files, 2176 tests passed, 90.4% statements
- Targeted unit (`quote-compare`, `quote-guards`, `schema`, `inspect-upload`): 98 passed
- R3 unit `src/lib/quote-compare.test.ts:268` (a h1 · b h1 reworded · c h3 reads like b): green; red with the R3 fix undone
- New e2e `e2e/quotes.spec.ts:170` (R3 end to end: solartec.pdf, the same bytes as voltia.pdf, then a different voltia.pdf): red with the R3 fix undone (`seenReadings.add` skipped for a file copy; 1 duplicate instead of 2, `r3-e2e-red-mutation.log`), green with it restored
- e2e `e2e/quotes.spec.ts` desktop: 39 passed (`e2e-desktop.log`). A first run at default workers had 2 timeouts in must-have tests (`:202`, `:287`); both passed 4/4 alone and in the full rerun
- e2e phone project (all `@phone` tests): 74 passed (`e2e-phone.log`). A first run had 1 failure at `:871` (language switch heading still English); it passed 3/3 alone and in the full rerun
- Merge areas: `api.ts:85` still calls `inspectUpload` from `./inspect-upload` before `fileFingerprint`; `quote-guards.ts` imports match staging; `pdf-info` (pdf-lib) is imported only by `inspect-upload.ts`; the built client (`.output/public`) has no pdf-lib (the only PDF filter strings are in the existing jspdf chunk); pdf-lib sits in `.output/server/_libs/pdf-lib.mjs`
- Screenshots: verdict after the R3 sequence at 1920x1080, 1024x768 and 375x667, plus crops of the two duplicate cards
