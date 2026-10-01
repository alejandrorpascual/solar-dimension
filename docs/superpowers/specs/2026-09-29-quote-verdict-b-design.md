# Quote verdict ("Leave it with us")

This builds on [Quote comparison](2026-09-26-quote-comparison-design.md), called "the base spec" below. It keeps the base spec's storage, job processing, model fallback, limits, privacy notes, model eval and cost sections as they are. It **replaces** the base spec's UI section and its comparison rules, and it **extends** the extraction schema and the data model.

Design reference: variant B on the [Budget Quote Comparison canvas](https://claude.ai/artifact/78LUwwV6zysWWDqPbSiuHg) (boards "B · hand-off", "B · verdict", "B · phone").

## Goals

1. A signed-in user uploads installer quotes to a project and gets on with their work. The app reads the quotes in the background and says so clearly.
2. The app picks the best quote: the cheapest one that meets every must-have of the project's kit.
3. For each quote, the app shows which items it includes (battery charger, Wi-Fi monitoring, cables, fuse, installation, warranty) and which it leaves out or doesn't mention.

## Decisions

- **Notifications are in-app only.** The tray, the project card and a one-time "Verdict ready" toast tell the user. There is no email and no browser notification. The copy never promises an email.
- **"Not mentioned" is never the best fit.** A quote that doesn't mention a must-have can't win until the user marks the item. If it would be the cheapest quote that fits once the unclear items are included, it gets a "Worth asking" note.
- **Must-haves can be changed per project.** The defaults are inverter, battery bank, battery charger, main cables, class T fuse and installation. Wi-Fi monitoring and warranty are nice-to-haves.
- **Progress comes from polling.** One hook in the root layout polls `getQuoteJobs()` every 3 s, but only while a job is queued or processing, or while a finished verdict hasn't been seen yet. There are no server-sent events.
- **The AI reads; code decides.** This is unchanged from the base spec. The model only extracts. Whether an item is included, whether the quote fits, the ranking and every sentence shown come from code.
- **No full extraction editor.** The user corrects the verdict with per-item Included / Not included switches and an editable total. The base spec's line-by-line edit form is out of scope for now.

## Flow

```
Kit step ── Upload quotes ──> client checks ──> uploadQuotes (server fn)
                                                  │ Blob (private) + quotes rows: queued
                                                  └ waitUntil(processQuote)  (base spec: primary → fallback → ready / needs_review / queued / failed)
Hand-off dialog ── Ok, got it ──> the user keeps working
__root: useQuoteJobs() ── polls every 3 s while active ──> Tray · project card line · "Verdict ready" toast
/projects/$projectId/quotes ──> verdict = compareQuotes(kit, musts, quotes)   (pure, recomputed on every render)
```

## Data model

One migration.

**`quotes`**: as in the base spec, plus:

| column | type | notes |
|---|---|---|
| `overrides` | jsonb not null default `{}` | `Partial<Record<ItemId, 'included' \| 'not_included'>>`, set by the user and winning over the extraction |
| `total_override` | double precision null | set when the user corrects the total on a `needs_review` quote |
| `seen_at` | timestamptz null | set when the user opens the verdict page, or dismisses the "Verdict ready" tray |

A quote counts as "unseen" when its status is `ready`, `needs_review` or `failed` and `seen_at` is null. Opening the verdict page marks every quote of that project as seen.

**`quote_settings`**:

| column | type | notes |
|---|---|---|
| `user_id`, `project_id` | text | primary key; FK to `projects (user_id, id)`, cascade delete |
| `musts` | jsonb not null | `Record<ItemId, boolean>`; a missing key means that item's default |
| `updated_at` | timestamptz | |

The must-haves live here, not on `projects`, so the project sync (serial queue, `pending` marker, `updatedAt` upsert guard) stays untouched.

## Extraction schema changes (`src/lib/quote-schema.ts`)

These are added to the base spec's `QuoteExtraction`:

- `lines[].kind` gains `charger`, `monitoring` and `fuse`.
- `lines[].optional: boolean`. True when the document offers the line as an extra that isn't in the total ("opcional", "+$120 si lo desea").
- `lines[].specs` gains:
  - `hasCharger: boolean | null` and `hasWifi: boolean | null` on inverters ("inversor híbrido con cargador 80 A", "WiFi integrado")
  - `chargerAmps: number | null`
  - `awg: string | null` on wiring (`"2/0"`, `"4"`), and `mm2: number | null`
  - `fuseAmps: number | null` and `fuseClass: string | null`
- `lines[].source: { page: number | null, text: string }`: the words of the document the line was read from, trimmed to 160 characters. It is shown as evidence when the user opens a quote's details.

The prompt adds one rule: mark a line `optional` only when the document says it isn't included in the price.

## Items and how each is decided (`src/lib/quote-items.ts`, pure)

`ItemId = 'inverter' | 'battery' | 'charger' | 'wifi' | 'cables' | 'fuse' | 'installation' | 'warranty'`.

Each item gets one status: `ok`, `short` (too small), `missing` (explicitly not included or optional), or `unknown` (not mentioned). It also gets a label ("5 kW hybrid"), an optional detail ("Kit needs 5,000 W"), and the evidence `source` when there is one.

| item | `ok` | `short` | `missing` | `unknown` |
|---|---|---|---|---|
| inverter | Σ inverter `watts` ≥ `kit.runningW` and surge ≥ `kit.surgeW` | either one below; the detail names the gap | — | no inverter line |
| battery | usable Wh ≥ `kit.loadWh / INVERTER_EFF` (DoD rule from the base spec) | below; the detail is "2.1 kWh short" | — | no battery line, or no kWh / (V × Ah) |
| charger | a non-optional `charger` line, or an inverter with `hasCharger: true` | — | only optional charger lines; the detail shows their price | otherwise |
| wifi | a non-optional `monitoring` line, or an inverter with `hasWifi: true` | — | only optional lines | otherwise |
| cables | a non-optional `wiring` line whose `awg` is the kit's `cable.gauge` or thicker; with no `awg` or `mm2`, `ok` with the detail "size not stated" | gauge thinner than the kit's | only optional lines | otherwise |
| fuse | a non-optional `fuse` line with `fuseAmps` ≥ `kit.cable.fuseA`, or with no amps stated | amps below the kit's | only optional lines | otherwise |
| installation | a non-optional `labor` line | — | only optional lines | otherwise |
| warranty | at least one entry in `warranties`; the label is "10 y / 5 y" (battery / inverter) | — | — | none |

An override wins: `included` becomes `ok` with the detail "Confirmed by you", and `not_included` becomes `missing`. Gauges compare on the AWG scale (4/0 > 3/0 > 2/0 > 1/0 > 1 > 2 …); `mm2` is used when `awg` is absent.

## Verdict (`src/lib/quote-compare.ts`, pure)

`compareQuotes(kit: SizingResult, musts: Record<ItemId, boolean>, quotes: QuoteView[]) → Verdict`

- Every `ready` quote gets its items and a **fit**:
  - `fits`: every must-have is `ok`
  - `unclear`: no must-have is `short` or `missing`, and at least one is `unknown`
  - `short`: otherwise
- `needs_review` quotes are listed with "Check the numbers" and are not ranked until the user saves a corrected total. `failed`, `queued` and `processing` quotes are listed with their status and are not ranked.
- **Currency**: ranking uses the project's most common currency among ready quotes. Quotes in other currencies are listed with "Different currency" and are not ranked.
- **Best**: the `fits` quote with the lowest total (`total_override ?? extraction.total`). If two quotes cost the same, the one meeting more nice-to-haves wins, then the one with the larger usable battery.
- **Order**: best first, then the other `fits` quotes by total, then `unclear` by total, then `short` by total.
- **Worth asking**: every `unclear` quote cheaper than the best (or any `unclear` quote when nothing fits). Each carries the list of unknown must-haves.
- **Deltas**: every ranked quote shows its total minus the best's total ("+$820", "−$330").
- **No fit**: when no quote fits, the page says so and names the smallest gap ("None of your quotes fits yet. EnerHogar is closest: its inverter is 1,400 W short.").

**Text** (`src/i18n` templates, in English and Spanish, with no model call):
- the heading: "SolarTec Caribe fits your kit for the least"
- the subline: "$6,480, the cheapest of your 4 quotes that meets all 6 must-haves."
- one reason line per quote: "Cheapest, but its 3.6 kW inverter is too small for this kit."
- the Worth asking copy
- the **question to copy**: "Hi Grupo Luz, does your quote include a battery charger and a 200 A class T fuse?", in the UI language

## UI

All of it follows DESIGN.md: its tokens, the shared classes, amber for caution and never red, and every status as a word or icon, not colour alone.

1. **Quotes card on the kit step.** It sits under the stat tiles, signed-in users only; signed-out users see "Sign in to compare quotes" with a link to /login. It has three states:
   - empty: "Got quotes from installers?" with **Upload quotes**
   - active: "4 quotes · Reading 2/4"
   - done: "Verdict ready · SolarTec $6,480" with **See verdict**

   You can also drop files onto the card. The browser checks type, size and the per-project and monthly limits before any upload.
2. **Hand-off dialog.** It opens once the upload is accepted: a React Aria `Modal` on desktop, the existing bottom sheet below 640 px. It shows one tile per file with a live status, the title "We've got it from here", and the body "Reading 4 quotes and checking each against the Casa Lomas kit takes about 2 minutes. Close this and keep working. The verdict will be waiting on the project." The buttons are **Ok, got it** (primary, closes) and **Watch progress** (goes to the verdict page).
3. **Progress tray** (`QuoteTray`, mounted in `__root`).
   - **Placement:** bottom right on desktop; above the sticky footer on phones.
   - **While reading:** "Comparing 4 quotes", then "2 of 4 read · about 1 min". The estimate is 30 s per quote still waiting, shown only after the first quote finishes. A progress bar shows the count, and a chevron opens the per-file list.
   - **When done:** it becomes "Verdict ready for Casa Lomas", with **See verdict** and a close button that sets `seen_at`.
   - **Accessibility:** `aria-live="polite"`, with no looping animation.
   - **Other pages:** it shows on every page except the verdict page for the same project.
4. **Project card line** (side rail): "Reading 2/4", "Verdict ready · SolarTec $6,480", "Check 1 quote" (needs review or failed), or nothing when the project has no quotes.
5. **Verdict page** (`/projects/$projectId/quotes`, new route, signed in, owner only):
   - **While jobs are running:** the file list with statuses, and the same wording as the tray.
   - **Top:** a back link to the kit, then the heading and subline.
   - **Two panels:** the best-fit card (total, gap to the next quote that fits, 8 item marks, **View original**), and the price-vs-fit dot plot. The plot has one row per ranked quote; the dot is filled only for `fits`, and a dashed line marks the best. Its accessible name lists every point.
   - **Other quotes:** "How the others compare" lists them as rows with rank, name, status pill, reason line, a 5-icon strip (charger, Wi-Fi, cables, fuse, install), total and delta.
   - **Opening a row** shows all 8 items with label, detail and evidence (quoted text and page). An `unknown` item gets an **Included / Not included** segmented control that saves to `overrides`. Per quote, it also has **View original** and **Delete**.
   - **Worth asking** notes (amber `.ask`) carry **Copy the question**.
   - **`needs_review`** rows show "Check the numbers" and an editable total with **Save**. **`failed`** rows show "Couldn't read it" with **Retry** and **Delete**.
   - **Bottom:** the note "Check the final terms with the installer before you pay", with **Add another quote** and **Change must-haves**.
   - **On load:** opening the page marks the project's quotes as seen.
6. **Change must-haves sheet.** Eight rows with "Must have" / "Nice to have" toggles. Saving writes `quote_settings`, and the verdict recomputes at once.
7. **"Verdict ready" toast.** It appears once, on the next app load after a verdict finished while the user was away (unseen quotes, and no tray showing). It links to the verdict page.

## Server functions (`src/server/quotes/`)

- `uploadQuotes(projectId, files)`: checks the limits, writes to Blob, inserts `queued` rows, and calls `waitUntil(processQuote)`. Returns the rows.
- `getQuoteJobs()`: every quote of the user that is queued, processing, or finished and unseen, grouped by project. Returns `{ projectId, projectName, total, done, failed, bestLabel }[]`. The poll also re-kicks stale jobs, as in the base spec.
- `getProjectQuotes(projectId)`: the verdict page's data (quotes with their extractions, overrides and totals, plus the must-haves).
- `setQuoteOverride(quoteId, item, value | null)`, `setQuoteTotal(quoteId, total)`, `setMusts(projectId, musts)`, `markSeen(projectId)`, `retryQuote(quoteId)`, `deleteQuote(quoteId)`.
- `/api/quotes/:id/file`: as in the base spec.

Every function checks the session user against `user_id`. Inputs are validated with Zod.

## Errors

- A rejected upload says why and what the limit is ("That file is 14 MB. The limit is 10 MB."). Nothing is stored and no model is called.
- A partly rejected batch uploads the files that pass, and lists the rejected ones in the hand-off dialog with their reasons.
- Reading failures follow the base spec. The user sees only the status, and **Retry** re-queues the quote with its attempts reset to 0.
- If polling fails, the tray keeps its last state, adds "Can't reach the server, retrying", and backs off to 10 s until a poll succeeds.
- If an override or must-have save fails, the change is rolled back, with "Couldn't save. Try again." next to the control.
- Deleting the last quote of a project removes its tray and its project card line.

## Testing

- **Unit**
  - the schema additions
  - every row of the items table, including overrides, optional lines, AWG and mm² comparisons, and the unknown cases
  - `compareQuotes`: best, ties, `unclear` worth asking, no fit and closest gap, currency split, `needs_review` exclusion, and the total override
  - the English and Spanish templates for the heading, reasons and the question to copy
  - the "unseen" rule
  - the ETA text
- **Integration**: `processQuote` with a stubbed model client, covering the base spec's five outcomes; `getQuoteJobs` grouping and re-kicking.
- **E2E** (the model stubbed through env, with fixtures matching the canvas's four sample quotes)
  - upload four files, see the hand-off dialog, close it, watch the tray count up, see "Verdict ready", open the verdict page: SolarTec is the best fit, and the dot plot and ranking are in order
  - turning Battery charger and Class T fuse into nice-to-haves makes Grupo Luz the best fit; turning them back restores SolarTec
  - marking Grupo Luz's charger and fuse as Included makes Grupo Luz the best fit at $6,150
  - reload after the verdict finished with the tray closed: the toast shows once
  - another user gets 404 on `/api/quotes/:id/file` and on the verdict route
- **Accessibility**: the dialog traps focus and returns it to **Upload quotes**, and the tray is announced politely. Test lookups use `exact: true` for short names (a past gotcha).

## Out of scope

- Email and browser notifications.
- The full extraction editor.
- Contacting installers from the app.
- Signed-out quotes.
- Other file formats (unchanged from the base spec).
