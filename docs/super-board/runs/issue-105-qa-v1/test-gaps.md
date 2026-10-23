# Test-gap check · issue #105 · head 389d777

## AC ledger

| AC | Unit | Component | e2e |
|---|---|---|---|
| 1. A changed upsert writes one entry with the row before and after | `src/lib/catalog-diff.test.ts:80` (the write planned) · `src/server/catalog-repo.test.ts:83` (row and entry sent in one transaction, before and after) · `:96` (new row, before null) | n/a: no component harness; the page is covered by e2e | `e2e/catalog-api.spec.ts:136` (watts 3500 to 3000 through the token API, read back from the database) |
| 2. An unchanged write writes none | `src/lib/catalog-diff.test.ts:87` · `src/server/catalog-repo.test.ts:105` (nothing sent) · `:130` (repeat retire or restore) | n/a | `e2e/catalog-api.spec.ts:136` (the same item posted twice logs one entry) |
| 3. A retire and a restore each write one entry | `src/lib/catalog-diff.test.ts:97` · `src/server/catalog-repo.test.ts:115` (update and entry in one transaction, each way) | n/a | `e2e/catalog-api.spec.ts:136` (retire then restore through the API) · `e2e/admin.spec.ts:33` (retire on the admin page, listed under the admin's email) |
| 4. `/admin/appliances` lists the 50 newest changes, newest first | `src/server/catalog-repo.test.ts:148` (newest first, limit 50, email joined) · `src/server/admin-catalog.test.ts:29` (non-admins get Not found) | n/a | `e2e/admin.spec.ts:33` ("Recent changes" table: the retire above the create, with the admin's email) |

All e2e rows ran green in CI run 39807105526 on the PR merge commit (see `ci-e2e-catalog.log`).
They were not run in this lane: a hook refused linking `.env.test.local` into the clone.

## Edge cases

| Class | State |
|---|---|
| 50-entry cap (49 / 50 / 51) | pinned `catalog-repo.test.ts:148` (limit param 50; M5 dies). The cap itself is the database's `limit` |
| Order of entries | pinned `catalog-repo.test.ts:148` (M6 dies) and `e2e/admin.spec.ts:70` |
| New row (before is null) | pinned `catalog-repo.test.ts:96`, `catalog-diff.test.ts:87`, `e2e/catalog-api.spec.ts:150` |
| Write and entry in one transaction | pinned `catalog-repo.test.ts:83`, `:115` (M2 dies) |
| Repeat retire / restore | pinned `catalog-repo.test.ts:130` (M4 dies) |
| Unknown id, row that fails the schema | pinned `catalog-repo.test.ts:140` (M10 dies) |
| Auth: signed out, non-admin, unverified admin email | pinned `admin-catalog.test.ts:29` (M11 dies); the page itself `e2e/admin.spec.ts:25` |
| Who: admin email vs `api-token` | pinned `catalog-repo.test.ts:148` (join and null email), `e2e/catalog-api.spec.ts:155` (actor `api-token`), `e2e/admin.spec.ts:72` (email shown) |
| Time shown in UTC | not pinned (Low) |
| Empty log ("No changes yet.") | not pinned (Low) |
| Long labels in "What changed" | not pinned (Low, visual) |
| Concurrent writers | documented limit in `src/server/catalog-repo.ts:48`; not tested (Low) |

## Test gaps (not written)

- Medium: saving the admin form with nothing changed is not pinned at the page. The rule is pinned (`catalog-diff.test.ts:87`, `catalog-repo.test.ts:105`) and the API repeat is pinned (`e2e/catalog-api.spec.ts:142`), but not that the form's round trip gives an identical item. Witness: Edit "Coffee maker", Save, expect no new "Recent changes" row; e2e rung, `e2e/admin.spec.ts`.
- Low: the empty state "No changes yet." has no test. Witness: no entries, expect the text; e2e rung.
- Low: the changes table's sideways scroll at phone width has no test.
- Low: the "When (UTC)" column text is not asserted (`2026-10-22 15:04` from `2026-10-22T15:04:05.123Z`).
