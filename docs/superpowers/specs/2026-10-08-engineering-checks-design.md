# Engineering checks for the sizing engine

Plan: `~/.claude/plans/dreamy-snacking-dijkstra.md` (session of 2026-10-08). Branch `claude/engineering-checks`.

## Why

An audit on 2026-10-08 found the engine rested on simplifications an installer would not accept: battery units were only volts and amp-hours, start-up assumed one motor at a time with no duration, air-conditioner duty was fixed in the catalog, cable sizing had one 105 °C column with no derating and a dead run-length input, the fuse was picked from the cable alone, runtime was one figure, parallel strings only warned above four, and every appliance was a single duty number.

## Decisions

- Hardware specs (battery units, inverters, gauges, fuses) stay typed constants in `src/lib/catalog.ts`; `compute(input, appliances, hardware = DEFAULT_HARDWARE)` takes them as an argument so an admin-managed table can replace them later without touching the math.
- Cable and fuse sizing follow NEC. No IEC path.
- Load kind and surge class are nullable catalog columns; the engine derives them when null. The first seed (migration 0004) stays byte for byte; migration 0012 adds the three momentary rows through `seedSqlFull`.
- Duty overrides live on the kit's quick-edit rows only, for cycling appliances, and are part of quick-edit Undo. Electrical settings live on step 2 and are not undoable, like volts.
- The Checks section prints last on the sheet, after the load schedule, so PDFs keep their page counts.
- Termination cap at 75 °C (NEC 110.14(C)). Visible change: the default 48 V Home kit moves from 8 AWG / 80 A to 2 AWG / 100 A, the correct NEC outcome for a 3 kVA inverter at 48 V. Do not tune constants back to the old numbers.
- The momentary rows (sliding gate, swing gate, parking barrier) carry typical values; the research-appliance skill's one-source-per-number rule applies before changing them.

## What changed

**Engine** (`src/lib/sizing.ts` → `src/lib/sizing/{types,loads,inverter,battery,runtime,cable,fuse,warnings}.ts`, `src/lib/nec.ts`): see the README's "Sizing assumptions". With default inputs the running load, surge, energy and battery picks are unchanged; cable and fuse change on purpose. New warning codes: `surgeDuration`, `bankDischarge`, `bankPeak`, `fuseAboveBank`, `fuseSurge`, `fuseInterrupt`, `startupDrop`, `cableAmbient`; `parallelStrings` now carries the unit's `maxParallel`. The result keeps `cable.fuseA` and `battery.hoursActual` (= `runtime.typical`) for the quote comparison, the deltas and the project cards.

**Project** (`src/lib/schema.ts`, `src/lib/store.ts`, `src/db/schema.ts`, `src/server/projects.ts`): `dutyOverrides` (by appliance id) and `electrical` (`simultaneousStarts` 1 | 2 | 'all', `runLengthM`, `ambientC` 30 | 40 | 50, `bundled`, `insulationC` 75 | 90), both jsonb `NOT NULL DEFAULT '{}'` and both with zod defaults and catches, so older stores and clients keep loading. Accepted risk, as with the requester: an old bundle's save resets both fields for that project.

**Catalog** (`src/lib/catalog-schema.ts`, `catalog-diff.ts`, `catalog-seed.ts`, `catalog-snapshot.ts`, `src/server/catalog-repo.ts`, admin form and table, `.claude/skills/research-appliance/SKILL.md`): nullable `kind`, `surgeClass`, `burstSeconds`, `cyclesPerHour`; momentary ⇔ both burst fields set and burst × cycles ≤ 3600; continuous ⇒ duty 1; a surge class needs a surge.

**UI** (`src/components`): `DutyControl` + `QuickEditRow` in `KitQuickEdit` (grouped by kind); `ElectricalSettings` (`StartsPicker`, `CableConditions`) on `BackupWindow`; `RuntimeRange` on the runtime tile and sheet figure; `ChecksList` under the parts (the warn box keeps only the general notes); `SheetSchedule` (grouped, Average column) and `SheetChecks` on `KitSheet`; `Checks` as a download include; CSV gains Kind and Average columns (`src/lib/kit-csv.ts`); parts move to `src/lib/kit-parts.ts` and add string fuses, the bank's currents and the parallel notes; the fine print (`src/lib/fine-print.ts`) states the settings the kit was sized with.

## Verification

- `npm run typecheck`; `npx vitest run` (735 tests).
- Dev server: Home at 48 V shows the runtime range, six passing checks, 2 AWG / 100 A class T; Refrigerator duty 100% moves the runtime tile (−4.2 h) and Undo restores it; step 2 "All at once" + 50 °C are reflected in the fine print and the cable check; the sheet prints Parts, Load schedule (grouped, Average column) and Checks on two pages.
- Playwright against the e2e Neon branch after `db:migrate`.
