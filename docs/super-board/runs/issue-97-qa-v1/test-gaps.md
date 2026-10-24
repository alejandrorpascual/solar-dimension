# Test-gap check · issue #97 · head c7e3fed

## AC ledger

| AC | Unit | Component | e2e |
|---|---|---|---|
| 1. An unreadable PDF appears on `/admin/quotes` with its file name and error | `src/server/admin-quotes.test.ts:80` (QA: file, account, project, error and time of each read) | n/a: the repo has no component tests | `e2e/admin.spec.ts:45` (row has the file name, the owner's email and `No stub fixture matches <file>`) |
| 2. A non-admin gets 404 on `/admin/quotes` | `src/server/admin-quotes.test.ts:52` (QA: signed out, not in ADMIN_EMAILS, admin address unverified: "Not found", nothing read) | n/a | `e2e/admin.spec.ts:36` (signed out, then a fresh non-admin account: "Page not found") |
| 3. The sweep answers `stuck`, `failed`, `trashed`; giving up on one stuck job reports stuck 1, failed 1 | `src/server/quotes/sweep.test.ts:73` (the AC's case) · `:81` · `:91` · `:105` · `src/server/quotes/repo.test.ts:40` (gaveUp counted) | n/a: API only | n/a: the AC names a unit test |

The e2e rows ran green in CI run 39856614223 on the PR merge commit (see `ci-e2e-admin.log`).
They were not run in this lane: the hook refused linking `.env.test.local` into the clone.

## Edge cases

| Class | State |
|---|---|
| Auth: signed out, other account, admin address unverified | pinned `admin-quotes.test.ts:52` (the call) · `e2e/admin.spec.ts:36` (the page) |
| Auth: the call refused before any read | pinned `admin-quotes.test.ts:62` (`db.select` never called) |
| Only failed reads, at most 50 | pinned `admin-quotes.test.ts:67` (where `status = 'failed'`, limit 50) |
| Time of a read with no `processed_at` | pinned `admin-quotes.test.ts:80` (falls back to the upload time) |
| Account or project gone (null email, project, error) | pinned in the data `admin-quotes.test.ts:88`; the page's `—` is not asserted |
| Volume: 0 failed reads | gap: the empty state "No quote read has failed." has no test |
| Boundary: 50 vs 51 failed reads, newest first | gap: ordering and the cut need the database; witness 51 failed rows, expect the 50 newest by `coalesce(processed_at, created_at)` |
| Sweep: one gave up | pinned `sweep.test.ts:73` |
| Sweep: re-run reads that end failed / ready / needs_review | pinned `sweep.test.ts:81` |
| Sweep: stuck job left for later | pinned `sweep.test.ts:91` |
| Sweep: trash removed vs kept | pinned `sweep.test.ts:105` |
| Sweep: a read that throws (outcome `error`) | gap: S6 in `mutants.txt` survives |
| Sweep: more stale jobs than SWEEP_LIMIT (20) | not pinned; by design `stuck` counts only the jobs this pass took up (comment at `sweep.ts:39`) |
| Money, data loss | n/a: read-only page; the sweep's writes are unchanged |
| Mobile: table scrolls inside the page | not verified: no screenshots in this lane (CSS `admin.css:15` sets `overflow-x: auto` at 640 px and below) |

## Test gaps (written)

- High: the list call refused non-admins in code but no test held it (CI coverage of `admin-quotes.ts`: 0%). The page's
  404 comes from its own `checkAdmin`, so removing `await requireAdmin()` would pass every existing test and send every
  account's email to anyone who calls the server function. Written in `src/server/admin-quotes.test.ts`; seen red on
  mutant G1, then green.

## Test gaps (not written)

- Medium: an `error` outcome (a read that throws in the sweep) counted as failed survives. Witness: `processQuote` rejects
  for job `a`, kick `['a']`, gaveUp 0; expected `stuck: 1, failed: 0`. Unit rung, `src/server/quotes/sweep.test.ts`.
- Medium: the empty state "No quote read has failed." has no test. e2e rung only when the test database has no failed
  read, which a shared database cannot promise; a component test would need a harness the repo does not have.
- Medium: ordering and the 50-row cut run only in SQL. Integration rung, a `*.db.test.ts` on the test database.
- Low: the tray's restart of stuck reads (`api.ts:119`) has no test (R2 survives); it had none before, and typecheck
  pins the new `{ kick }` shape.
- Low: `stuck` leaves out stale jobs beyond the sweep's 20 per run; the ticket says "jobs it found stale". Documented
  in the code; a count only.
