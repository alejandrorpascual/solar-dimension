# Issue 208 QA v4 (`5d1f276`)

| Check | Result |
|---|---|
| Targeted unit (`quote-compare`, `quote-guards`, `schema`, `inspect-upload`) | 103/103 at `5d1f276`; 104/104 with the QA test |
| R4 mutation (`isUntouchedCopy` forced false) | 5 builder unit tests red, `e2e/quotes.spec.ts:186` red, QA's case-2 e2e red; restored, all green |
| New unit: only changed upload can't rank | green; red when touched files are counted over all uploads, not rankable ones |
| New e2e: case 2 (untouched first, edited second), en + es help | green; red under the R4 mutation (Grupo Luz ranked, no "Uploaded twice") |
| Full unit + coverage | 2182/2182 · 90.41% statements (`unit-coverage.log`) |
| Typecheck, build | clean |
| Desktop `e2e/quotes.spec.ts` | 41/41, no retries needed (`e2e-desktop.log`) |
| Phone project | 74/74 (`e2e-phone.log`) |
| `e2e/shared-browser.spec.ts:223` flake | not run in these projects; not seen |

Screenshots: case 2 state (Voltia upload has a confirmed charger, Grupo Luz upload of the same file untouched), en and es, desktop 1920×1080, tablet 1024×768, mobile 375×667, crops of the hidden copy's card.
