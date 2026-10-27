# QA v1 · #47 · head a9c2e04

| AC | Result | Proof |
|---|---|---|
| 1 per-field accuracy and invented-value count per model | pass | `ac1-dry-run.log`, `supplied-and-full-plan.log`: 13 cases x 2 fake models x 3 runs; fake-expected 39/39 exact, 0 invented; fake-wrong 0/39, 39 invented |
| 2 scorer unit test: perfect = 100%, one invented value counts once | pass | `src/lib/quote-eval.test.ts:25`, `:43`, `:166`, `:186`; three mutants all go red (`ac2-mutation.log`) |
| 3 not run by the unit suite or CI | pass | `ac3-not-in-ci.log`: `CI=1` refuses with exit 1; vitest collects 146 files, none outside `src/`; `ci.yml` has no `eval` |
| 4 first baseline committed beside the cases | not verified | needs the owner's paid run (78 model calls) |

Verify command (config): typecheck exit 0 · test:coverage 2318/2318, exit 0 · build exit 0.

Test gaps (not written):
- Medium: case 05 and 08 expect `total: 0` for a blank total (schema `total` is not nullable yet, `pending` in case.json). A model that invents a total there counts as a wrong total, not as an invented value, until the schema allows null.
- Low: the CLI guards in `scripts/eval-quotes.ts` (CI refusal, no `--yes`, `--runs` range) have no unit test; checked by hand here.
