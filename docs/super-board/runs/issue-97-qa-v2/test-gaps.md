# Test-gap check · issue #97 · QA v2 · head 9449e44

Scope: the whole PR against staging `e80cdbb`, with the rebuild (R1, R2) and the two `[qa]` findings (R3, R4).

## AC ledger

| AC | Unit | Component | e2e |
|---|---|---|---|
| 1. An unreadable PDF appears on `/admin/quotes` with its file name and error | `src/server/admin-quotes.test.ts:80` (file, account, project, error, time) | n/a: the repo has no component tests | `e2e/admin.spec.ts:45` (QA v2: all five cells, project included) |
| 2. A non-admin gets 404 on `/admin/quotes` | `src/server/admin-quotes.test.ts:52` (signed out, other account, unverified admin: "Not found", nothing read) | n/a | `e2e/admin.spec.ts:36` |
| 3. The sweep answers `stuck`, `failed`, `trashed`; giving up on one stuck job reports stuck 1, failed 1 | `src/server/quotes/sweep.test.ts:73` (the AC's case) · `repo.test.ts:50` (a give-up counts failed only when stored failed) | n/a: API only | n/a: the AC names a unit test |

## Edge cases

| Class | State |
|---|---|
| Sweep: a read that throws (outcome `error`) | pinned by QA v2 `sweep.test.ts:91` (R3; S6 and S7 killed) |
| Sweep: a give-up stored needs_review, or a row that finished first | pinned `repo.test.ts:50` (rebuild, M1 killed) |
| Sweep: a re-read stored needs_review | pinned `process.test.ts:112`, `repo.test.ts:123` (rebuild, M3 killed) |
| Sweep: more stale jobs than the pass starts | pinned `repo.test.ts:61`, `sweep.test.ts:115` (rebuild, M2 killed) |
| Sweep: re-run reads that end failed / ready / needs_review | pinned `sweep.test.ts:81` |
| Sweep: trash removed vs kept | pinned `sweep.test.ts:124` |
| Page: project column | pinned by QA v2 `e2e/admin.spec.ts:45` (R4) and `admin-quotes.test.ts:80` |
| Auth: the call refused before any read | pinned `admin-quotes.test.ts:52` |
| Volume: 0 failed reads (empty state) | gap: Medium, unchanged since v1 |
| Boundary: 50 vs 51 failed reads, newest first | gap: Medium, SQL only, unchanged since v1 |
| Mobile: the table scrolls inside the page | not verified: no screenshots in this lane |

## Test gaps (written)

- R3 (Medium in v1, raised by the Reviewer): `sweep.test.ts:91`, a read that throws counts stuck 1, failed 0, outcome
  `error`, and logs the job id. Seen red on S6 and S7, green restored.
- R4 (nit): `e2e/admin.spec.ts:45` checks the File, Account, Project, Error and Time cells of the row, not only the
  row's text. The project comes from the test database (`firstProjectName` in `e2e/db.ts`).

## Test gaps (not written)

- Medium: the empty state "No quote read has failed." has no test. A shared test database cannot promise zero failed
  reads; a component test needs a harness the repo does not have.
- Medium: ordering and the 50-row cut run only in SQL. Integration rung, a `*.db.test.ts` on the test database.
- Low: the tray's restart of stuck reads (`api.ts:120`) has no test; typecheck pins the `{ kick }` shape.
- Low: `giveUp` logs every id it tried, including one that finished first and was left as it is (`repo.ts:92`).
