# Verdict page, variant A ("Cards with a gauge"): design

**Date:** 2026-09-30
**Status:** Draft, waiting for review
**Goes into:** PR #6 (`claude/budget-quote-upload-design-5f3048`), on top of `2185cea`
**Design source:** Design canvas https://claude.ai/artifact/Kf6T4ErXForao53KMu6VFm, `project/Main.dc.html` (390 px phone board, Spanish copy)

## Why

The user ran PR #6 on a phone with 7 real quotes, and the verdict page didn't work there:

- **Rows wrapped one word per line.** The three-column row (rank | text | price) squeezed the middle column to about 40 px.
- **The price-vs-fit plot overlapped its labels** at 390 px.
- **Nothing showed how oversized an option is.** For example, Voltinela's 12 kW inverter against a 5.2 kW need.
- **Four quotes from "LIRO Services" looked identical.**

Variant A replaces the rows with stacked cards. It shows sizing as a zoned gauge on the best card and as two small bars on every other card, and it removes the plot.

## What stays true

The Global Constraints in `docs/superpowers/plans/2026-09-29-quote-verdict-b.md` still apply. These matter most here:

- **The AI reads; code decides.** Every zone, ratio and sentence comes from `src/lib`.
- **EN and ES ship together.**
- Sentence case, and no "Please".
- Amber for caution, never red.
- Colour always paired with a word.
- 44 px tap targets on phones.
- No motion under `prefers-reduced-motion`.
- Immutable helpers.

**No schema change, no migration, no change to ranking.** `compareQuotes` is untouched. This is presentation plus pure helpers.

## 1. Sizing: `src/lib/quote-sizing.ts` (new, pure)

```ts
export const SIZING_ZONES = { JUST_MAX: 1.3, ROOMY_MAX: 2, GAUGE_MAX: 2.5 } as const
export type SizingZone = 'short' | 'just' | 'roomy' | 'over'
export interface Sizing { have: number; need: number; ratio: number; zone: SizingZone; pos: number }

sizingRatio(have: number | undefined, need: number): number | null   // null when have is unknown or need <= 0
sizingZone(ratio: number): SizingZone   // < 1 short · <= 1.3 just · <= 2 roomy · > 2 over
gaugePos(ratio: number): number         // 0–100, ratio / GAUGE_MAX, clamped
quoteSizing(items: readonly ItemCheck[], kit: KitNeeds): { inverter: Sizing | null; battery: Sizing | null }
suggestedInverterW(kit: KitNeeds): number
```

- **Inputs.**
  - Inverter: `facts.watts` against `kit.runningW`.
  - Battery: `facts.usableWh` against `kit.usableWh`.
  - These are the same facts `checkItems` already computes.
  - A component whose size the quote doesn't state gets `null`, and the UI draws no gauge for it.
  - The inverter ratio uses running watts only. Surge stays in the item check and the reason line.
- **Zones.**

  | Zone | ES | Ratio |
  |---|---|---|
  | Short | Falta | < 100 % |
  | Right-sized | Justo | 100–130 % |
  | Roomy | Holgado | 130–200 % |
  | Oversized | De más | > 200 % |

  - The boundaries are inclusive on the lower zone: exactly 1.3 is `just`, and exactly 2 is `roomy`.
  - The gauge spans 0–250 %, so the zone widths are 40 / 12 / 28 / 20 %, which matches the board.
- **Oversize tip.**
  - The tip shows when the inverter zone is `over`. A big battery gets no tip: spare storage isn't waste the same way.
  - `suggestedInverterW` is the smallest 500 W step at or above `max(runningW × 1.15, surgeW / 2)`.
  - The `surgeW / 2` term exists because inverters usually surge to about 2× their rating. A suggestion that fixes the oversize but can't start the kit would be wrong.
  - Example: the user's kit needs 5.2 kW running, so the tip suggests 6 kW. `SAMPLE_KIT` (3,860 W running, 9,400 W surge) gets 5 kW.

## 2. Text: `src/lib/quote-text.ts` and the EN/ES dictionaries

New builders. Each takes `t` and returns a string, with all wording in the dictionaries.

| Builder | EN example | ES example |
|---|---|---|
| `zoneName(t, zone)` | Short / Right-sized / Roomy / Oversized | Falta / Justo / Holgado / De más |
| `zonePill(t, s)` | `3.1× what it needs` · `+19 %, right-sized` · `+60 %, with room to spare` · `47 % of what it needs` | `3,1× lo necesario` · `+19 %, a la medida` · `+60 %, con margen` · `47 % de lo necesario` |
| `ratioLabel(t, ratio)` (mini bars) | `1.15×` when ≥ 1, `47 %` when < 1 | `1,15×` · `47 %` |
| `gaugeTitle(t, id, s)` | `Inverter 12.0 kW` · `Battery 26.1 kWh usable` | `Inversor 12,0 kW` · `Batería 26,1 kWh útiles` |
| `gaugeLabel(t, id, s)` (a11y name) | `Inverter: 12.0 kW against 3,860 W needed, oversized` | `Inversor: 12,0 kW frente a 3.860 W necesarios, de más` |
| `gaugeLegend(t)` | `Right-sized: up to 30 % more than your kit uses. Oversized: more than double.` | `Justo: hasta 30 % más de lo que usa tu kit. De más: más del doble.` |
| `oversizeTip(t, kit)` | `The inverter is more than double what your kit uses. Ask whether there's a 5,000 W version: it usually costs less.` | `El inversor es más del doble de lo que usa tu kit. Pregunta si hay una versión de 5.000 W: suele bajar el precio.` |
| `coverageLines(t, items)` | `Includes charger, Wi-Fi and installation` · `Too small: cables` · `Not included: fuse` · `Doesn't mention warranty` | `Incluye cargador, Wi-Fi e instalación` · … |
| `deltaText(t, r)` (changed) | `$6,597 less than the best` · `$3,878 more than the best` | `USD 6.597 menos que la mejor` · … |
| `unrankedTitle(t, unranked)` | `Without a total, these can't be compared` when every unranked quote waits for a total (`no_total` or `needs_review`); otherwise `Not compared yet` | `Sin total, no se pueden comparar` · `Aún sin comparar` |

Notes on the builders:

- **Percent and ratio numbers.**
  - `zonePill` rounds percents to whole numbers.
  - It shows `×` with one decimal when the ratio is ≥ 2.
  - `+0 %` reads `Exactly what it needs` / `Justo lo necesario`.
  - The gauge legend's 30 % and "double" come from `SIZING_ZONES` through placeholders, not literals.
- **`coverageLines`**
  - It covers the strip items: charger, Wi-Fi, cables, fuse, installation. Inverter and battery are covered by the gauges and the reason line.
  - It returns up to four `{ kind: 'ok' | 'short' | 'missing' | 'unknown'; text }` entries, with empty groups left out.
  - It uses a new lower-case item map, `quoteItemsList`, in both languages. EN: charger, Wi-Fi, cables, fuse, installation, inverter, battery, warranty. ES: cargador, Wi-Fi, cables, fusible, instalación, inversor, batería, garantía.
- **Removed keys:** `vsBest`, `priceAndFit`, `plotHelp`, `plotRule`, `plotPoint`, `nextFitGap` and `onlyFit`. The best card drops the next-fit line, because every other card now states its gap to the best.
- **Checks button.**
  - The visible text is `Show checks` / `Ver comprobaciones`.
  - The accessible name becomes `Show checks for {name}` / `Ver comprobaciones de {name}`: a visually hidden suffix, so the visible label stays inside the name (WCAG 2.5.3).
  - The hide state mirrors it.
  - The E2E selectors change to match.

## 3. Subtitle: `quoteSubtitle(q)` in `src/lib/quote-compare.ts`

- It returns `q.fileName` when the shown name (`quoteName`) isn't the file name, and `null` otherwise. That way the name never repeats.
- This tells the four "LIRO Services" rows apart by their files.
- **Not now:** quote numbers such as "Cotización 0033664". They need a new extraction field, a prompt change and a re-read of every stored quote. That's a separate change if file names turn out not to be enough.

## 4. Components

All components live in `src/components/quotes/`.

- **`KitNeeds.tsx` (new).**
  - Two tiles under the header: `Inverter, your kit` with `fmtW(kit.runningW)`, and `Usable battery, your kit` with `fmtKwh(kit.usableWh)`.
  - Markup: `<section aria-label="What your kit needs">`.
  - Shown only when there's at least one ranked quote.
- **`SizingGauge.tsx` (new).**
  - One component, props `{ id: 'inverter' | 'battery'; s: Sizing }`.
  - Title row: `gaugeTitle`, plus a pill with `zonePill`. Pill tone by zone: short = warn, just = ok, roomy = neutral, over = info (accent tint).
  - Then a `role="img"` block labelled by `gaugeLabel`, containing:
    - the four-zone bar (CSS grid, `40fr 12fr 28fr 20fr`, 3 px gaps);
    - a triangle marker at `pos %`;
    - the four zone names under the bar, with the active one bold and in its ink colour.
- **`SizingBars.tsx` (new).**
  - The mini version for other cards: a 3-column grid of label | track | `ratioLabel`.
  - Each track has a fill at `pos %` and a 2 px tick at 40 % (the 100 % need).
  - Fill colour: amber when short, green when just or roomy, accent when over.
  - Rows with an unknown size are left out. The whole block is hidden when both are unknown.
  - It's `aria-hidden`, and the card carries the meaning in text instead: an sr-only sentence built from `gaugeLabel` for each known component.
- **`BestCard.tsx` (rewrite).** Still a `<section>` labelled by the name, so `getByRole('region', { name })` keeps working. Contents, in order:
  1. The `Best fit` pill.
  2. A top line: name (h2) with `quoteSubtitle` under it on the left, and the total (`num`, 28 px on phones) on the right.
  3. A gauge for each known component.
  4. The legend.
  5. The oversize tip when it applies: an info box with an icon, in accent tint and accent-hover ink.
  6. The coverage lines, each with a mark: ✓ = ok, ! = short or missing, ? = unknown. The marks are `aria-hidden` because the words carry the meaning.
  7. The actions row: the `Show checks` button (flex 1), then `QuoteActions` (View original, Delete).
  8. The checks panel (`ItemList`) when open.
  9. The error.
  - The `qbest__items` grid goes away.
- **`QuoteRow.tsx` (rewrite).** Still an `<article>`. The rank badge and the five-icon strip go away. Contents:
  1. A top line: name (h3, one line, ellipsis) with the subtitle under it (ellipsis) on the left, and the total on the right.
  2. A line with the fit pill and `deltaText`.
  3. `reasonLine` at full width.
  4. `SizingBars`.
  5. One meta line: the coverage entries joined with ` · `.
  6. `AskBox`, when the quote is worth asking about.
  7. The `Show checks` text button.
  8. The checks panel and the actions, when open.
  9. The error.
- **`UnrankedRow.tsx`.**
  - A top line: name with the subtitle on the left, the pill on the right.
  - The form stays as it is: the input takes the remaining width, and Save sits beside it.
  - No other behaviour changes.
- **`VerdictView.tsx`.**
  - The page reads top to bottom: back link, `VerdictHeader`, `KitNeeds`, then the best card and the others.
  - **Desktop (≥ 1024 px):** `.qv__grid` puts the best card in a 400 px left column and the "How the others compare" cards on the right.
  - **No best:** the ranked cards span the full width under "Your quotes".
  - **Unranked:** now its own section below, titled by `unrankedTitle`.
  - `PricePlot` is no longer mounted.
- **Deleted:** `PricePlot.tsx`, `src/lib/quote-plot.ts` and `quote-plot.test.ts`, every `.qplot*` rule, and `.qrank` and the `.qrow__strip` and `.qrow__head` grid rules once nothing uses them.

## 5. CSS: `src/styles/quotes.css`

- **Zone tokens, scoped on `.qv`:**

  | Token | Value | Use |
  |---|---|---|
  | `--qz-short` | `#FFE3B0` | Short zone |
  | `--qz-just` | `#BFE3CD` | Right-sized zone |
  | `--qz-roomy` | `#D5DAE2` | Roomy zone |
  | `--qz-over` | `#AEBCF6` | Oversized zone |
  | `--qz-short-fill` | `#C98A12` | Short fill on the mini bars |

  The others reuse `--success`, `--accent`, `--warn-ink` and `--accent-hover`. The app has no dark theme, so light values only.
- **Cards.**
  - `.qlist__rows` becomes a flex column with a 12 px gap.
  - Each `.qrow` is its own card: surface, `--line` border, 14 px radius, 16 px padding.
  - That replaces the shared bordered box with row dividers.
- **Phone rules** (`max-width: 1023px`):
  - The best card is padded 18 px.
  - Names ellipsize, and totals never wrap (`white-space: nowrap`).
  - The `Show checks` and Save buttons are at least `var(--tap)` high.
- **Reduced motion:** the gauge has no animation, so the reduced-motion block needs no new entries.

## 6. Testing

- **Unit (Vitest, written first):**
  - `quote-sizing.test.ts`: ratio, zones and their boundaries (0.99, 1, 1.3, 1.31, 2, 2.01), `gaugePos` clamping, `quoteSizing` with unknown sizes, and `suggestedInverterW` for `SAMPLE_KIT` and a 5.2 kW kit.
  - `quote-text.test.ts`: each new builder in EN and ES, and the new `deltaText`.
  - `quote-compare.test.ts`: `quoteSubtitle`.
  - The 80 % coverage floor on `src/lib` and `src/i18n` still applies.
- **E2E** (`e2e/quotes.spec.ts`):
  - Replace the plot assertion with a check that the best-fit region has an `img` named `/^Inverter: .+ needed, /`.
  - Rename the checks-button selectors.
  - Assert a row's `… less than the best` / `… more than the best` text.
  - Add a phone-project check that no ranked card's name and total overlap. Their bounding boxes in the top line should not intersect, and the reason's box should be at least 200 px wide.
- **Phone screenshots:** run Playwright's `phone` project (iPhone 13) on the 4-quote verdict and save full-page screenshots in EN and ES to the scratchpad for the user. They aren't committed.
- **Full gate:**

  ```bash
  npm run typecheck && npm test && npm run build && CI=true E2E_PORT=3137 npx playwright test e2e/quotes.spec.ts
  ```

  This runs on the Neon e2e branch through `loadTestEnv()`. Never use plain `npm run dev`.

## Out of scope

- Quote numbers from the PDF (see §3).
- Battery oversize tips.
- Any ranking change.
- Dark theme.
- Pushing. That waits for the user, then CI runs the full E2E.
