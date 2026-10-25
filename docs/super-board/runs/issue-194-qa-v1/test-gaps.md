# #194 QA v1 · test-gap check

Range: `af4957e...db6d2b0` (7 files, all `src/styles`).

## Ledger
| AC | Unit (Vitest) | E2E (Playwright) |
|---|---|---|
| 1 tokens for every duration | `src/styles/styles.test.ts:24` | n/a: static property of the CSS text |
| 2 `.btn`, `.chip`, links ease hover with the tile token | `src/styles/styles.test.ts:42` (CSS text only) | `e2e/motion-focus.spec.ts:79` computed transition vs `.tile` |
| 3 same 2 px accent ring at 1440 px | `src/styles/styles.test.ts:42` (CSS text only) | `e2e/motion-focus.spec.ts:48` Tab focus, computed outline on stepper, chip, Sign in, duty select |
| 4 reduced-motion blocks turn motion off | `src/styles/styles.test.ts:51` | `e2e/motion-focus.spec.ts:103` new hover rule and menu animation off |

## High gaps written (were: AC2 and AC3 had no test that a browser applies the rule)
- `e2e/motion-focus.spec.ts`: red on the staging build `af4957e` (chip ring `auto 1px rgb(0,95,204)`, `.btn` transition `all 0s`), green on `db6d2b0`.
- Mutation: deleting the base.css reduced-motion line turns the reduced-motion test red; restored.

## Test gaps (not written)
- Medium: the AC1 unit test reads `transition:`/`animation:` one line at a time; a `transition-duration:` longhand or a declaration split over lines would slip past it. None exist today (`rg` over src/styles finds 0).
- Low: stepper ring offset is 4 px, the shared ring 2 px; the AC asks for the same width and colour, which match.
- Low: `.tile` and other component transitions have no reduced-motion rule (unchanged by this PR).
