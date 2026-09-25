# Kit Side Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the variant A side rail (project summaries with quick edit, downloads) and an inline quick editor on the kit step.

**Architecture:** Pure helpers in `src/lib` (store targeting any project, project summaries, deltas, appliance search, CSV) carry the logic and the unit tests. Thin React components in `src/components` render the rail, cards, quick editor, download panel and export sheet. Browser-only file creation lives in `src/client/export-file.ts` behind dynamic imports.

**Tech Stack:** TanStack Start, React 19, react-aria-components, lucide-react, Vitest, Playwright, new: `html-to-image@^1.11.13`, `jspdf@^4.2.1`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-25-kit-side-rail-design.md`.
- Every user-facing string exists in `src/i18n/en.ts` and `src/i18n/es.ts` and its key in `UiKey`.
- Rail breakpoint: 1280 px. Rail width: 380 px. Export sheet width: 794 px, A4 pages.
- No side-scrolling chip rows. Touch targets ≥ 44 px on phones.
- Immutable updates only; store helpers return new objects.
- `npm run typecheck`, `npm test`, `npm run test:coverage` (80% gate) and `npm run e2e` stay green.

---

### Task 1: Store helpers for any project

**Files:** Modify `src/lib/store.ts`; Test `src/lib/store.test.ts`.

**Produces:**
- `clampHours(n: number): number` (1–72, integer)
- `patchProject(store: Store, id: string, patch: Partial<Project>): Store` (stamps `updatedAt`; unknown id returns store unchanged)
- `setQtyIn(store: Store, id: string, itemId: string, n: number): Store`
- `setHoursIn(store: Store, id: string, hours: number): Store`
- `restoreProject(store: Store, snapshot: Project): Store` (puts back `qty`, `custom`, `hours` of the snapshot, new `updatedAt`)
- `patchCurrent` and `setQty` delegate to the above.

- [ ] Tests: setQtyIn edits only the named project and stamps it; clamps to 0–100; unknown id is a no-op; setHoursIn clamps 0 → 1 and 99 → 72 and truncates 10.7 → 10; restoreProject brings back qty and hours but keeps name; existing setQty tests still pass.
- [ ] Run `npx vitest run src/lib/store.test.ts` → FAIL, implement, → PASS. Commit `feat: store helpers that edit any project`.

### Task 2: Project summaries, kit deltas, appliance search, CSV

**Files:** Create `src/lib/project-summary.ts`, `src/lib/kit-deltas.ts`, `src/lib/appliance-search.ts`, `src/lib/export-csv.ts` with a `.test.ts` beside each.

**Produces:**
- `computeProject(p: Project): SizingResult`
- `interface ProjectSummary { project: Project; result: SizingResult; loadShare: number; heaviest: SelectedItem[]; moreCount: number }`; `summarizeProjects(projects: readonly Project[], topN = 3): ProjectSummary[]` (loadShare 0–1 of the heaviest project's running watts, 0 when all are empty; heaviest by `totalWatts` desc)
- `interface KitDeltas { runningW: number; surgeW: number; requiredWh: number; runtimeH: number }`; `kitDeltas(before: SizingResult, after: SizingResult): KitDeltas` (runtime from `battery.hoursActual`, 0 when either has no battery; runtime rounded to whole hours before subtracting)
- `searchAppliances(items: readonly CatalogItem[], query: string, nameOf: (i: CatalogItem) => string, excludeIds: ReadonlySet<string>, limit = 5): CatalogItem[]` (empty query → `[]`; matches localised name, catalog name, id or category, case-insensitive)
- `csvCell(v: string | number): string` (quote when it has `,`, `"`, CR or LF; double inner quotes)
- `interface CsvInput { appliances: { name: string; qty: number; eachW: number; runningW: number; wh: number }[]; parts: { name: string; spec: string; note: string; qty: string }[]; headers: { appliances: string[]; parts: string[] }; include: { appliances: boolean; parts: boolean } }`; `buildCsv(input: CsvInput): string` (CRLF lines, blank line between blocks, leading BOM `﻿` for Excel)
- `exportFileName(projectName: string, ext: string): string`

- [ ] Tests per function including: empty projects; custom appliances in search; excluded ids; a name with a comma and quote in CSV; include toggles dropping a block; file name `"Casa, playa!"` → `Casa-playa-kit.pdf`, `"***"` → `kit.pdf`.
- [ ] FAIL → implement → PASS. Commit `feat: project summaries, kit deltas, appliance search and CSV export`.

### Task 3: i18n strings

**Files:** Modify `src/i18n/types.ts`, `en.ts`, `es.ts`.

Keys: `projects`, `projectsCount`, `current`, `quickEdit`, `done`, `appliancesCount`, `windowLabel`, `hourLess`, `hourMore`, `saved`, `undo`, `allAppliances`, `addApplianceSearch`, `noSearchMatch`, `projectMeta`, `heaviestMore`, `emptyProject`, `bank`, `inverterShort`, `download`, `downloadTitle`, `format`, `include`, `fmtPdf`, `fmtPdfHint`, `fmtPng`, `fmtPngHint`, `fmtCsv`, `fmtCsvHint`, `incSummary`, `incAppliances`, `incParts`, `incNotes`, `downloadPdf`, `downloadPng`, `downloadCsv`, `share`, `making`, `exportFailed`, `close`, `sheetTitle`, `loadSchedule`, `each`, `overHours`, `total`, `csvAppliance`, `csvQty`, `csvEach`, `csvRunning`, `csvWh`, `csvPart`, `csvSpec`, `csvNote`, `removeAll`.

- [ ] `npm run typecheck` passes (the `Dictionary` type forces both languages). i18n test still passes. Commit with Task 4.

### Task 4: Quick edit on the kit

**Files:** Create `src/components/QtyStepper.tsx`, `src/components/KitQuickEdit.tsx`; modify `src/components/ApplianceCard.tsx` (export `QtyField`), `src/components/KitSummary.tsx`, `src/routes/index.tsx`; create `src/styles/rail.css`, import it in `src/styles.css`.

**Consumes:** Task 1 store helpers, Task 2 `kitDeltas`, `searchAppliances`.

`KitSummary` props become `{ result, baseline: SizingResult | null, projectName, quickEdit: ReactNode, onBatteryUnit }`. `KitQuickEdit` props: `{ store, commit, onAllAppliances }`; it owns `open` and `snapshot` state and reports the baseline upward through `onBaseline(p: Project | null)`.

- [ ] Replace the Edit chips; update `e2e/kit-builder.spec.ts` ("moving between steps" and "full flow") to use "Appliances · N" and "All appliances".
- [ ] New e2e: open quick edit, press "One more Refrigerator" twice → running load shows a `+` delta; window "One hour more" → summary says 11 hours; Undo → delta gone and 10 hours.
- [ ] Commit `feat: quick edit appliances and the window on the kit`.

### Task 5: Side rail with project cards

**Files:** Create `src/components/SideRail.tsx`, `src/components/ProjectCards.tsx`; modify `src/components/ProjectBar.tsx`, `src/routes/index.tsx`, `src/styles/base.css` (`.page` max width 1720 px at ≥1280), `src/styles/rail.css`.

`SideRail` props: `{ store, commit, tab, onTab, onPicked? }`. `RailSheet` props: `{ isOpen, onOpenChange, ...SideRail props }` using react-aria `ModalOverlay`/`Modal`/`Dialog`.

- [ ] ProjectBar: remove the chip row; add `Projects · N` button (hidden ≥1280) that opens the sheet.
- [ ] Update e2e project tests with a helper `openProjects(page)` that clicks the Projects button when visible.
- [ ] New e2e: add a second project, quick edit a LED line on the Home card without selecting it → Home card runtime changes, current project unchanged.
- [ ] Commit `feat: side rail with project summaries and quick edit`.

### Task 6: Download tab and export

**Files:** Create `src/components/KitSheet.tsx`, `src/components/DownloadPanel.tsx`, `src/client/export-file.ts`; modify `SideRail.tsx`, `WizardFooter.tsx` (Download button on step 3, hidden ≥1280), `package.json`.

`export-file.ts`: `renderPng(node: HTMLElement): Promise<Blob>` (html-to-image `toBlob`, pixelRatio 2, white background), `renderPdf(node: HTMLElement): Promise<Blob>` (toPng → jsPDF A4 pt, image scaled to page width, repeated with negative y offsets and one alias for extra pages), `saveBlob(blob: Blob, name: string): void`, `canShareFiles(): boolean`, `shareFile(file: File, title: string): Promise<'shared' | 'cancelled'>`.

- [ ] `npm i html-to-image jspdf`.
- [ ] New e2e: CSV download has `Part` header row and `Refrigerator`; PDF download starts with `%PDF`.
- [ ] Commit `feat: download the kit as PDF, image or CSV`.

### Task 7: Verify and ship

- [ ] `npm run typecheck && npm run test:coverage && CI=true npm run e2e`.
- [ ] Check in the browser pane at 1440 px and at phone width: rail, cards, quick edit, sheet, download preview.
- [ ] Code review pass; fix HIGH issues.
- [ ] Push branch, open PR with summary and test plan.
