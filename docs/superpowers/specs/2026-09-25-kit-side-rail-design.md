# Kit side rail: project summaries, quick edit and downloads

Variant A ("Side rail") from the design canvas https://claude.ai/artifact/HQZc9rLjx8ctmk4tzpcQhE.

## Goals

1. See every saved project's result (runtime, bank, inverter, load) without walking to step 3.
2. Change appliance quantities and the backup window on the kit screen, and on any saved project, without going back to step 1.
3. Download the kit as a PDF spec sheet, a phone-sized image or a CSV parts list.

Out of scope: public share links (projects stay private), adding new appliances to a non-current project, choosing paper size.

## Decisions

- **Sharing**: no link. Where the browser can share files (`navigator.canShare({ files })`), a Share button sends the kit image to the system share sheet. Elsewhere there is no share button.
- **PDF**: a real file made in the browser. `html-to-image` renders the export sheet to PNG; `jspdf` places it on A4 pages. Both are loaded with dynamic `import()` only when the user downloads.
- **Edits save immediately**, like every other control in the app. The kit's quick editor offers Undo back to how the project looked when the editor was opened.
- **No side-scrolling chips.** The project chip row is replaced: on wide screens by the rail, on narrow screens by a "Projects" button that opens the rail in a sheet.

## Layout

- **≥1280 px**: the page becomes a two-column workspace. Left: the existing header, project tools and stage. Right: a 380 px sticky rail with two tabs, *Projects* and *Download*. The rail shows on every step.
- **<1280 px**: the rail is hidden. The project bar gets a "Projects · N" button that opens the rail as a modal sheet (bottom sheet on phones, centred dialog on tablets) on the Projects tab. On step 3 the footer adds a "Download" button that opens the same sheet on the Download tab.
- The project bar keeps its rename field, Duplicate and Delete. On wide screens it no longer lists projects (the rail does).

## Kit quick edit (step 3)

`KitSummary`'s two chips ("Edit appliances", "Edit window") become a quick-edit bar:

- **Appliances · N** disclosure button (aria-expanded) toggling an inline panel, closed by default.
- **Window** stepper: −/+ one hour, clamped to 1–72 h, with the value between.
- When the project differs from the snapshot taken on first edit: "Saved" status and an **Undo** button that restores the snapshot's quantities and hours.

The panel lists every selected appliance (catalog and custom) with a quantity stepper: − (a trash icon at quantity 1, which removes it), a typeable count (the existing `QtyField`), +. Below the list, a search field shows up to five unselected catalog or custom appliances whose localised name, id or category matches; choosing one adds it with quantity 1 and clears the field. A link "All appliances" goes to step 1.

The four stat tiles show a signed delta next to the value (for example "+120 W", "−2 h") against the snapshot while the project differs from it.

## Projects tab

One card per project, in store order. Each card:

- The project name as a button (selects that project; `aria-current` on the current one) and a "Current" badge on the current project.
- Meta line: `48 V · 10 h · 7 appliances`.
- Three figures: runtime, bank energy, inverter size. Empty projects show "Nothing selected yet" instead.
- A load bar: running watts relative to the heaviest project.
- Up to three heaviest appliances by running watts ("Refrigerator, TV, 4× LED lighting and 3 more").
- **Quick edit** toggle revealing a stepper per selected appliance, editing that project in place without selecting it. The open project's card has no Quick edit: the main area already edits it, and the kit's Undo only tracks edits made there.

A "+ New project" button sits above the list.

## Download tab

- A live, scaled-down preview of the export sheet.
- Format radio group: Spec sheet (PDF), Summary image (PNG), Parts list (CSV), each with a one-line hint.
- Include checkboxes: summary figures, appliance list, parts list, assumptions. The preview follows them. CSV uses only the appliance and parts choices.
- Download button (label follows the format) and, when supported, Share.
- A busy state while the file is made and an inline alert if it fails ("Could not create the file. Try again."). A cancelled share is not an error.

File names: `<project name>-kit.<ext>`, with characters outside letters, digits, spaces, `-` and `_` removed, spaces turned into `-`, and "kit" when nothing is left.

## Export sheet

`KitSheet` is a fixed-width (794 px, A4 at 96 dpi) document built from `SizingResult` and the include options: title, date, voltage/chemistry/window line, the four figures, a load schedule (appliance, qty, each, running W, Wh over the window, totals), the parts table and the assumptions line. It is rendered in the preview (CSS-scaled) and, for downloads, into an off-screen container that is captured and then removed.

## Units

| Unit | Kind | Responsibility |
| --- | --- | --- |
| `lib/store.ts` | pure | `patchProject`, `setQtyIn`, `setHoursIn`, `restoreProject`, `clampHours`; `setQty`/`patchCurrent` reuse them |
| `lib/project-summary.ts` | pure | `computeProject(p)`, `summarizeProjects(projects)` (result, load share, heaviest items) |
| `lib/kit-deltas.ts` | pure | `kitDeltas(before, after)` numeric differences for the four tiles |
| `lib/appliance-search.ts` | pure | `searchAppliances(items, query, nameOf, excludeIds, limit)` |
| `lib/export-csv.ts` | pure | `buildCsv(...)`, `csvCell`, `exportFileName` |
| `client/export-file.ts` | browser | `renderPng`, `renderPdf`, `saveBlob`, `canShareFiles`, `shareFile` |
| `components/QtyStepper.tsx` | UI | −/trash, `QtyField`, + |
| `components/KitQuickEdit.tsx` | UI | disclosure, window stepper, undo, appliance panel |
| `components/SideRail.tsx` | UI | tabs; `RailSheet` modal wrapper for narrow screens |
| `components/ProjectCards.tsx` | UI | cards with quick edit |
| `components/DownloadPanel.tsx` | UI | preview, format, include, download/share |
| `components/KitSheet.tsx` | UI | the export document |

Styles for the rail, cards, quick edit, download panel and sheet go in a new `styles/rail.css`.

## Errors

- Export: rendering or PDF creation failures are caught, logged with `console.error` and shown as the inline alert; the button leaves its busy state.
- Share: `AbortError` is ignored; other errors show the same alert.
- Quantity and hours input goes through `clampQty` / `clampHours`, so the schema never sees out-of-range values.

## Testing

- Unit (Vitest): every new pure function in `lib/`, keeping the 80% coverage gate.
- E2E (Playwright, desktop and phone):
  - quick edit on the kit changes the runtime, shows a delta, and Undo restores it; the window stepper changes the hours;
  - quick edit on a non-current project's card changes that card's figures only;
  - CSV and PDF downloads produce files (`%PDF` header for the PDF);
  - on phone, the Projects button opens the sheet and selecting a project closes it.
- Existing tests that click "Edit appliances"/"Edit window" or project chips are updated to the new controls.
