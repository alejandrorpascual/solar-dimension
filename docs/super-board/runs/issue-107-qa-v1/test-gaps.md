# Test-gap check · issue #107 · head 91eb7d3

## AC ledger

| AC | Unit | Component | e2e |
|---|---|---|---|
| 1. The schema accepts items with and without sources | `src/lib/catalog-schema.test.ts:56` (with and without) · `:66` (QA: 3 sources, 200 characters) · `:71` (rejects http, 201 characters, an extra key, blank words, an empty list, 4 sources, a figure that takes none) | n/a: the repo has no component tests | `e2e/admin.spec.ts:131` (the API answers 200 to a write with sources) |
| 2. A token write with sources round-trips through GET | `src/server/catalog-repo.test.ts:125` (SQL sends them on insert and update; `listRecords` returns them) | n/a: API only | `e2e/admin.spec.ts:131` (POST, then GET returns the same sources) |
| 3. A later token write or admin form save without sources keeps them | `src/lib/catalog-diff.test.ts:102` (planned row keeps them, no change counted) · `src/server/catalog-repo.test.ts:136` (SQL sends the stored ones back, log shows them kept) · `:146` (a row that fails the schema keeps its too) | n/a | `e2e/admin.spec.ts:134` (token write without sources) · `:146` (admin form save) |
| 4. The admin row shows them | none | n/a: the repo has no component tests | `e2e/admin.spec.ts:140` (the row's link has the words as written and the page as href) · `:148` (still there after the form save) |
| 5. The skill text has the three lines | n/a: docs | n/a | n/a: read in `.claude/skills/research-appliance/SKILL.md:49-51` (datasheet or nameplate first; two independent sources; label rules of thumb) |

The e2e rows ran green in CI run 40014734016 on the PR merge commit 586b1d7 (91eb7d3 into staging 9d72f6d): see
`ci-e2e.log`. CI also applied migration 0016 to the test branch and to an empty database (17 of 17 migrations).
They were not run in this lane: the hook refused linking `.env.test.local` into the clone.

## Edge cases

| Class | State |
|---|---|
| Boundary: sources per figure 0 / 1 / 3 / 4 | pinned: 0 `catalog-schema.test.ts:76`, 1-2 `:56`, 3 `:66` (QA), 4 `:77` |
| Boundary: words as written blank / 200 / 201 | pinned: blank `:75`, 200 `:66` (QA), 201 `:73` (QA) |
| Input: a link that is not https (http, `javascript:`) | pinned for http `:72`; `javascript:` fails the same protocol rule, and a read re-checks every stored row with the schema (`catalog-repo.ts:16`) |
| Input: a key besides `source` and `asWritten`; a figure that takes no sources (`tons`) | pinned `:74` (QA) · `:78` |
| Data loss: write without sources keeps them (token and form) | pinned `catalog-diff.test.ts:102` · `catalog-repo.test.ts:136` · e2e `admin.spec.ts:134`, `:146` |
| Data loss: row that fails the schema, written over | pinned `catalog-repo.test.ts:146` |
| Replace and clear (`{}`) | pinned `catalog-diff.test.ts:111` |
| Idempotency: the same sources again, keys in another order | pinned `catalog-diff.test.ts:123` |
| Change log: a sources change is logged with from and to | pinned `catalog-diff.test.ts:111` (`writtenFields`) |
| Rows written before the column | pinned `src/db/schema.test.ts:23` (not null, default `{}`); CI migrated the test branch and an empty database |
| Auth: who may write sources | unchanged: the token API and the admin form keep their checks (`e2e/catalog-api.spec.ts:10`, `e2e/admin.spec.ts:37`); `GET` needs the token, and the public catalog (`toCatalogItem`) carries no sources |
| Race: two writes to one appliance at once | not pinned: a write without sources sends back the sources it read, so a write with sources landing between that read and its write is undone. Every other field already behaves this way (each write sends the whole row) |
| UI: sources under Surge, Duty, and Burst / Cycles of a momentary row | gap: e2e checks the Watts source only (mutants U1, U2 in `mutants.txt`). Seen right in the screenshots below |
| UI: figure with no sources shows only the number | seen in the screenshots (Chest freezer, Microwave, Parking barrier); not asserted |
| UI: mobile | the table scrolls sideways inside the page as before (`admin.css:16-19`); page width stays 375 px |

## Screenshots

`ac4-admin-sources-*.png` are the real `AdminAppliances` component of `src/routes/admin/appliances.tsx` at 91eb7d3,
rendered to HTML with `react-dom/server` and fixture rows (the seed's Refrigerator, Chest freezer, Microwave, Sliding
gate motor and Parking barrier, with sources on the Refrigerator and the gate motor), wrapped in the app's own
stylesheets (`src/styles.css` and its imports, `src/components/admin/admin.css`) and fonts, and shot with Playwright
Chromium at 1920×1080, 1024×768 and 375×667. No server or database: the hook refused the test env link. The harness
was a throwaway and is not committed. Each page shows 7 source links, the count the fixture holds. The browser run on a
real database is the CI e2e above.

`before-ac4-admin-*.png` are the same rows through the staging page (`appliances.tsx` and `admin.css` at 9d72f6d),
shot the same way, for the Before | After table: no source lines under any figure.

## Test gaps (written)

- Medium: three schema limits had no test at their edge, so changing them passed every test (mutants K9, K10, K11 on
  91eb7d3): 3 sources a figure, 200 characters as written, no extra keys on a source. Written in
  `src/lib/catalog-schema.test.ts:66` and `:73-74`; each seen red on its mutant (and K16, a 300-character cap), then green.

## Test gaps (not written)

- Medium: the admin row's sources under Surge, Duty and a momentary row's Burst / Cycles have no assertion (U1, U2).
  Witness: an appliance with `{ surge: [s1], burstSeconds: [s2] }` shows "“s1”" in the Surge cell and "Burst: “s2”"
  in the Kind cell. e2e rung (`e2e/admin.spec.ts`), since the repo has no component tests; not written here because
  this lane cannot run e2e to see it fail first.
- Low: the race above. Fixing it means SQL that keeps the column when a write sends none, not a test.
- Low: Recent changes prints a sources change as raw JSON; on a phone one change runs about 40 lines
  (`ac4-admin-sources-mobile.png`). Readable, not pretty; the change log prints every object field this way.
