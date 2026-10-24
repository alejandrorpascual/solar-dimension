# Test-gap check · issue #217 · QA v1 · head fda5a7d

Scope: the whole PR against staging `a51e1a7`: `src/hooks/useProjectStore.ts`, `src/lib/tab-sync.ts` and their two new
test files. No UI changes, so no screenshots.

## AC ledger

| AC | Unit | Hook (component rung) | e2e |
|---|---|---|---|
| 1. An account change clears all sync state with one reset; a save after a failed save and a switch names no field edited before it | n/a: the reset is one assignment, `useProjectStore.ts:114` | `useProjectStore.account-change.test.ts:40` (failed, then switch) · `:63` (in flight across the switch). Both red on the old hook: the save named `hours, qty`, want `qty` | n/a: needs two accounts holding the old shared first-project id and a failed save across a sign-in in another tab; the hook harness drives it exactly |
| 2. One sync-state object in place of the five refs; the `useProjectStore*.test.ts` suites pass unchanged | `tab-sync.test.ts:19`, `:29`, `:39` | `useProjectStore.ts:91` is the only sync ref; the 6 existing suites have no diff against `a51e1a7` and pass, 82/82 | n/a: no screen change; the sync e2e files pass, 66/66 |

## Edge cases

| Class | State |
|---|---|
| Auth: a save after the account changed | pinned `account-change.test.ts:40` (M1 killed) |
| Race: a save sent before the switch that fails after it | pinned `account-change.test.ts:63` (M2 killed) |
| Race: a save sent before the switch that works after it | n/a: equivalent (M3), the queue runs the new account's load after it and its list replaces `held` |
| Error: a load that failed, then a save that works | pinned `useProjectStore.test.ts:125` (M13 killed) |
| Volume: carried projects and deletes | pinned `useProjectStore.test.ts:63`, `:80` (M11, M12 killed) |
| `held` after a read and after a save | pinned `useProjectStore.sync.test.ts:240`, `:254` (M4, M6, M9 killed) |
| Read window: a field edited and set back to its value while a read is out | gap: Medium (M7 survives) |
| UI states, accessibility | n/a: no screen change |

## Test the tests

The two new hook tests watch the requests at the fake server and the account it keeps, with literal expected values.
Fourteen mutants, ten killed (`mutants.txt`). M3, M5 and M10 change nothing a request or the screen can show.

## Test gaps (written)

- None. No High gap: both ACs have a test that was seen red, and the auth and race paths are pinned.

## Test gaps (not written)

- Medium (M7): `edited` in `src/lib/tab-sync.ts:57` adds an edit to the read window, and no test needs it. Witness:
  a read is out; hours goes to 24, then back to where it was; the account's list says 8. The screen should keep the
  value set back; with M7 it shows 8 (a throwaway unit test, not committed, was green, then red on M7). Pre-existing:
  the old hook had the same untested branch. Unit rung, `src/lib/tab-sync.test.ts`.
