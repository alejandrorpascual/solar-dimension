# Test-gap check · issue #103 · head ffde65e

## AC ledger

| AC | Unit | Component | e2e |
|---|---|---|---|
| 1. Surge 30× watts warns | `src/lib/catalog-schema.test.ts:101` · `src/lib/catalog-diff.test.ts:74` | n/a: API only | `e2e/catalog-api.spec.ts:70` (dry run and write) |
| 2. A 60% change from the stored row warns | `src/lib/catalog-diff.test.ts:54` | n/a: API only | `e2e/catalog-api.spec.ts:70` (watts 100 to 160) |
| 3. Seeded rows warn only "Over 5 kW" on the 5-ton ACs | `src/lib/catalog-schema.test.ts:155` | n/a: API only | n/a: the seed is code; the unit test reads all of it |
| 4. Dry-run and write responses carry the warnings | none: route and repo need a database | n/a: API only | `e2e/catalog-api.spec.ts:70`, plus the `warnings: []` shape at `:47`, `:107`, `:114` |

All e2e rows ran green in CI run 39678819178 on the PR merge commit (see `ci-e2e-catalog.log`).
They were not run in this lane: the hook refused linking `.env.test.local` into the clone.

## Edge cases

| Class | State |
|---|---|
| Surge boundary (10× exactly / 10.4×) | pinned `catalog-schema.test.ts:104-105` |
| AC watts boundary (550, 2200, 2201, 110; 1.5 tons plural) | pinned `catalog-schema.test.ts:111-115` |
| Change share boundary (exactly 50%) | gap: fridge watts 150 to 225 should warn nothing (M3 survives) |
| Change down vs up | pinned `catalog-diff.test.ts:62-71` (150 to 15, 1200 to 15, 0.35 to 0.7) |
| Stored value 0 (division) | n/a: schema needs watts, surge >= 1 and duty > 0, and stored rows are parsed through it (`catalog-repo.ts:16`) |
| New item, no stored row | pinned `catalog-diff.test.ts:74` |
| Items with nothing to say are left out | pinned `catalog-diff.test.ts:57` (fridge-2) |
| Write warns against the rows before the write | pinned `e2e/catalog-api.spec.ts:95` (the update's answer still lists the 60% change) |
| A warning never refuses a write | pinned `e2e/catalog-api.spec.ts:86-87` (created, row exists) |
| Duplicate ids in one request | n/a: `parseItems` refuses them before any warning (`catalog-schema.ts:153-160`) |
| Auth, money, data loss | n/a: no auth or write path changed; warnings only |

## Test gaps (not written)

- Medium: change of exactly 50% is unpinned (`share > MAX_CHANGE_SHARE` to `>=` survives). Witness: fridge watts 150 to 225, expected `[]`, unit rung, `src/lib/catalog-diff.test.ts`.
- Low: a change just over 50% prints a rounded 50% (watts 1000 to 1501 reads "a change of 50%"), which reads oddly against an "over 50%" rule. Copy only.
- Low: the admin form now also shows the surge and AC size warnings (`src/components/admin/ApplianceForm.tsx:54`); no component test covers that form's warning list. Not an AC.
