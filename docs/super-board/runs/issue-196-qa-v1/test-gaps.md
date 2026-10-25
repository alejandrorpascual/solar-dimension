# Test-gap check · #196 · head 0a52ba6

Scope: `git diff --name-only origin/staging...HEAD` (4 files). No auth, money, data-loss or security path, so done inline, no sub-agent.

## Ledger

| AC | Unit | Component | e2e |
|---|---|---|---|
| 1 Compressor empty option reads "Not set" | `src/components/admin/ApplianceForm.test.ts:23` asserts the three option texts of the real component | n/a: the unit test renders the real component | none committed; browser capture in `ac1-options.json` (accessible value "Not set") |
| 2 Privacy and Terms links at least 24 px tall at 390 px | n/a: a box height needs a browser | n/a | `e2e/legal-links.spec.ts:9` on `/` and `/login`, desktop and phone (iPhone 13, 390 px) projects |

## Edge cases

| Class | Result |
|---|---|
| Boundary: limit - 1, limit | pinned: mutant 23 px is red (`mutants.txt` 3); 24 px passes (`< MIN_TARGET_PX`) |
| Other empty options in the form | none left: the two others read "auto (derived)"; `rg '<option value=""' src` finds only these three |
| Accessibility: role and accessible name | captured: `combobox "Compressor"` with `option "Not set" [selected]` (`ac1-options.json`) |
| Footer links covered by the sticky bar at the page bottom | not covered at 375 px: hit-test at the centre of each link, `ac2-link-boxes.json` |
| Both pages that render the links | `/` and `/login` measured at 24 px (`LegalLinks` is the only user) |
| Spanish text, 320 px wrap | gap, Low: the rule is `min-height`, so a wrapped link is taller, never shorter |
| Dot between the links centred (`align-items: center` on `.legal`) | gap, Low: cosmetic, no assertion |

## Test the tests

- Unit test: the regex returns `[]` when the field is missing, so a renamed label fails instead of passing empty.
- e2e test: asserts two links first (`toHaveCount(2)`), so a removed link fails instead of passing on an empty list.
- Reverting each change turns its test red (`mutants.txt`).

## Test gaps (not written)

- Low: Spanish locale and 320 px width on the footer links.
- Low: dot alignment between the links.
