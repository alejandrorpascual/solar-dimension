# Verdict Page Variant A ("Cards with a Gauge") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan runs as a `Workflow` script:**
> - One implementer agent per task, in order, because the tasks share files.
> - A fresh reviewer after each task.
> - One whole-branch reviewer at the end.

**Goal:** The quote verdict page reads well on a 390 px phone:
- stacked cards;
- a zoned sizing gauge on the best card;
- sizing bars on the other cards;
- a tip when the inverter is more than double what the kit needs;
- no price-vs-fit plot.

**Architecture:**
- **Sizing is a new pure module:** `src/lib/quote-sizing.ts`. It computes ratio, zone and gauge position from the `ItemCheck` facts that `checkItems` already produces.
- **Wording lives in `src/lib/quote-text.ts`**, backed by the EN/ES dictionaries.
- **Components:**
  - New: `SizingGauge`, `SizingBars`, `KitNeedTiles`, `ChecksToggle`.
  - Rewritten: `BestCard` and `QuoteRow`.
  - `VerdictView` drops `PricePlot` and gives unranked quotes their own section.
- **Unchanged:** ranking (`compareQuotes`) and the database.

**Tech Stack:** React 19, TanStack Start, plain CSS (`src/styles/quotes.css`), Vitest (node, `src/**/*.test.ts`), Playwright (`desktop` and `phone` = iPhone 13 projects).

**Spec:** [docs/superpowers/specs/2026-09-30-verdict-phone-a-design.md](../specs/2026-09-30-verdict-phone-a-design.md). The design board is `project/Main.dc.html` in https://claude.ai/artifact/Kf6T4ErXForao53KMu6VFm.

## Global Constraints

- **Worktree.** Work in `/Users/alejandrorpascual/projects/solar-dimension/.claude/worktrees/budget-quote-upload-design-5f3048`, on branch `claude/budget-quote-upload-design-5f3048` (PR #6). Never push.
- **Logic and wording live in `src/lib`.** No component computes a ratio, a zone or a sentence. Components only call `src/lib` helpers and read `t.quotes.*`.
- **EN and ES ship together.** Every new string goes in both `src/i18n/quotes-en.ts` and `src/i18n/quotes-es.ts`. The types enforce the same keys in both.
- **Copy rules:**
  - Sentence case, and no "Please".
  - EN writes percents without a space ("47%"), ES with one ("47 %").
- **Colour and status:**
  - Amber for caution, never red. `--error` is kept for Delete.
  - Every status pairs a colour with a word.
- **Phones:** 44 px tap targets (`var(--tap)`) under `max-width: 1023px`.
- **Motion:** every transition is off under `prefers-reduced-motion`.
- **Code style:**
  - Immutable helpers. No mutation of inputs.
  - Named constants, no magic numbers.
  - Match the surrounding code: terse JSDoc on exports, no comment noise.
- **Commits:** `<type>: <description>` (feat, fix, test, refactor, docs, chore), with **no attribution or Co-Authored-By lines**. Stage only the files your task touched (`git add <paths>`), never `git add -A`.
- **Database.** `.env.local` is PRODUCTION. Never run `npm run dev`, `npm run start` or `db:*` directly. E2E loads the Neon e2e branch through `e2e/test-env.ts`, and the Playwright config starts its own servers.
- **Checks:**
  - Unit: `npx vitest run <file>`; all: `npm test`.
  - Types: `npm run typecheck`.
  - E2E: `CI=true E2E_PORT=3137 npx playwright test e2e/quotes.spec.ts` (Task 7 only; about 6 min).

## Review Focus

1. **A quote whose inverter the user marked "Not included" still carries its watts** in `facts`. It must show no gauge for that component. Covered by the Task 1 test `ignores a component the user marked not included`.
2. **Ratios at the zone edges and near 100 %.**
   - 1.3 is Snug and 2 is Roomy.
   - 0.996 reads "99%", never "100% of what it needs".
   - 1.004 reads "Exactly what it needs".
   - Covered by the Task 1 zone table and the Task 2 `zonePill` tests.
3. **Long names, long totals and the reason line on a 390 px phone.** The name must ellipsize, the total must never wrap, and the reason must keep its width. Covered by the Task 7 phone layout test.
4. **Gauge zone names at phone width.** They must not overlap: "Snug" / "Justo" sit in a 12 % column. Covered by the Task 7 phone layout test.
5. **A quote that states neither size, or a kit that needs no battery** (`usableWh` 0). The card must render with no gauge, legend, bars or tip. Covered by the Task 1 `quoteSizing` null tests, with guards in Tasks 3–5.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/lib/quote-sizing.ts` | create | Zones, ratio, gauge position, `quoteSizing`, `suggestedInverterW` |
| `src/lib/quote-sizing.test.ts` | create | Its tests |
| `src/i18n/format.ts`, `format.test.ts` | modify | `fmtDecimal` |
| `src/lib/quote-text.ts`, `quote-text.test.ts` | modify | Sizing, coverage, delta and unranked-title text |
| `src/lib/quote-compare.ts`, `quote-compare.test.ts` | modify | `quoteSubtitle` |
| `src/i18n/quotes-en.ts`, `quotes-es.ts`, `types.ts`, `en.ts`, `es.ts`, `i18n.test.ts` | modify | Strings and the `quoteItemsList` map |
| `src/components/quotes/SizingGauge.tsx` | create | The best card's four-zone gauge |
| `src/components/quotes/SizingBars.tsx` | create | The mini bars on the other cards |
| `src/components/quotes/KitNeedTiles.tsx` | create | The "What your kit needs" tiles |
| `src/components/quotes/ChecksToggle.tsx` | create | The shared Show checks / Hide checks button |
| `src/components/quotes/BestCard.tsx` | rewrite | The best card |
| `src/components/quotes/QuoteRow.tsx` | rewrite | The other ranked cards |
| `src/components/quotes/UnrankedRow.tsx` | modify | Its top line |
| `src/components/quotes/VerdictView.tsx` | modify | Wiring, sections, tiles; no plot |
| `src/components/quotes/PricePlot.tsx`, `src/lib/quote-plot.ts`, `quote-plot.test.ts` | delete | |
| `src/styles/quotes.css` | modify | Zone tokens, gauge, bars, cards; remove `.qplot*` and the old row grid |
| `e2e/quotes.spec.ts` | modify | New selectors and the phone layout test |

---

### Task 1: Sizing lib and `fmtDecimal`

**Files:**
- Create: `src/lib/quote-sizing.ts`
- Test: `src/lib/quote-sizing.test.ts`
- Modify: `src/i18n/format.ts` (add `fmtDecimal` after `fmtKwh`), `src/i18n/format.test.ts`

**Interfaces:**
- Consumes:
  - `ItemCheck` and `KitNeeds` from `src/lib/quote-items.ts`.
  - `facts.watts` is the inverter's running watts. `facts.usableWh` is the battery's usable Wh. Both are `undefined` when the quote doesn't state them.
  - `status: 'missing'` means not included, including by the user's override.
- Produces:
  ```ts
  export const SIZING_ZONES: { readonly JUST_MAX: 1.3; readonly ROOMY_MAX: 2; readonly GAUGE_MAX: 2.5 }
  export type SizingZone = 'short' | 'just' | 'roomy' | 'over'
  export type SizedId = 'inverter' | 'battery'
  export const SIZED_IDS: readonly SizedId[]                     // ['inverter', 'battery']
  export interface Sizing { have: number; need: number; ratio: number; zone: SizingZone; pos: number }
  export interface QuoteSizing { inverter: Sizing | null; battery: Sizing | null }
  export const GAUGE_ZONES: readonly { zone: SizingZone; width: number }[]   // widths in % : 40, 12, 28, 20
  export const NEED_POS: number                                   // 40, where 100 % of the need sits on the gauge
  export function sizingRatio(have: number | undefined, need: number): number | null
  export function sizingZone(ratio: number): SizingZone
  export function gaugePos(ratio: number): number
  export function quoteSizing(items: readonly ItemCheck[], kit: KitNeeds): QuoteSizing
  export function suggestedInverterW(kit: KitNeeds): number
  // src/i18n/format.ts
  export function fmtDecimal(n: number, digits: number, locale: Locale): string  // fixed decimals: "3.1", "1.15"
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/quote-sizing.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES } from './quote-fixtures'
import { checkItems } from './quote-items'
import {
  gaugePos, GAUGE_ZONES, NEED_POS, quoteSizing, sizingRatio, sizingZone, SIZING_ZONES, suggestedInverterW, type SizingZone,
} from './quote-sizing'

describe('sizingRatio', () => {
  test('is the quote value over the kit need', () => {
    expect(sizingRatio(12000, 4000)).toBe(3)
  })
  test('is null when the quote states no size or the kit needs nothing', () => {
    expect(sizingRatio(undefined, 4000)).toBeNull()
    expect(sizingRatio(5000, 0)).toBeNull()
    expect(sizingRatio(5000, -1)).toBeNull()
    expect(sizingRatio(5000, Number.NaN)).toBeNull()
  })
})

describe('sizingZone', () => {
  test.each<[number, SizingZone]>([
    [0, 'short'], [0.99, 'short'], [1, 'just'], [1.3, 'just'], [1.31, 'roomy'], [2, 'roomy'], [2.01, 'over'], [12, 'over'],
  ])('%s is %s', (ratio, zone) => {
    expect(sizingZone(ratio)).toBe(zone)
  })
  test('the legend and the tip say "double", so the roomy zone ends at 2', () => {
    expect(SIZING_ZONES.ROOMY_MAX).toBe(2)
  })
})

describe('the gauge', () => {
  test('spans 0 to 250 %, clamped', () => {
    expect(gaugePos(0)).toBe(0)
    expect(gaugePos(1)).toBe(40)
    expect(gaugePos(2.5)).toBe(100)
    expect(gaugePos(4)).toBe(100)
    expect(NEED_POS).toBe(40)
  })
  test('zone widths match the design board and fill the bar', () => {
    expect(GAUGE_ZONES.map((z) => z.zone)).toEqual(['short', 'just', 'roomy', 'over'])
    expect(GAUGE_ZONES.map((z) => z.width)).toEqual([40, 12, 28, 20])
  })
})

describe('quoteSizing', () => {
  test('a 12 kW inverter and 34.8 kWh against the sample kit are both oversized', () => {
    const s = quoteSizing(checkItems(SAMPLE_QUOTES.solartec, KIT), KIT)
    expect(s.inverter).toMatchObject({ have: 12000, need: 3860, zone: 'over', pos: 100 })
    expect(s.inverter?.ratio).toBeCloseTo(3.109, 3)
    expect(s.battery).toMatchObject({ have: 34816, need: 8000, zone: 'over', pos: 100 })
  })
  test('a 300 W inverter and 1.1 kWh are short', () => {
    const s = quoteSizing(checkItems(SAMPLE_QUOTES.enerhogar, KIT), KIT)
    expect(s.inverter?.zone).toBe('short')
    expect(s.battery?.zone).toBe('short')
    expect(s.battery?.pos).toBeCloseTo(5.44, 2)
  })
  test('is null for a component whose size the quote does not state', () => {
    const s = quoteSizing(checkItems(extraction([line('inverter', 1000), line('battery', 2000)]), KIT), KIT)
    expect(s).toEqual({ inverter: null, battery: null })
  })
  test('ignores a component the user marked not included', () => {
    const s = quoteSizing(checkItems(SAMPLE_QUOTES.solartec, KIT, { inverter: 'not_included' }), KIT)
    expect(s.inverter).toBeNull()
    expect(s.battery).not.toBeNull()
  })
  test('is null for the battery when the kit needs no stored energy', () => {
    const kit = { ...KIT, usableWh: 0 }
    expect(quoteSizing(checkItems(SAMPLE_QUOTES.solartec, kit), kit).battery).toBeNull()
  })
})

describe('suggestedInverterW', () => {
  test('is the next 500 W step above the running load plus 15 %', () => {
    expect(suggestedInverterW({ ...KIT, runningW: 5200, surgeW: 8000 })).toBe(6000)
  })
  test('never suggests one that cannot start the kit, assuming a 2× surge rating', () => {
    expect(suggestedInverterW(KIT)).toBe(5000)
    expect(suggestedInverterW({ ...KIT, runningW: 2000, surgeW: 9000 })).toBe(4500)
  })
})
```

Add to `src/i18n/format.test.ts`: import `fmtDecimal` alongside the others, and add this block.

```ts
describe('fmtDecimal', () => {
  test('always shows the given number of decimals', () => {
    expect(fmtDecimal(3.1088, 1, 'en')).toBe('3.1')
    expect(fmtDecimal(2, 1, 'en')).toBe('2.0')
    expect(fmtDecimal(1.15, 2, 'en')).toBe('1.15')
    expect(fmtDecimal(3.1088, 1, 'es')).toBe((3.1).toLocaleString('es-419', { minimumFractionDigits: 1 }))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quote-sizing.test.ts src/i18n/format.test.ts`
Expected: FAIL. The module `./quote-sizing` isn't found, and `fmtDecimal` isn't exported.

- [ ] **Step 3: Implement**

In `src/i18n/format.ts`, after `fmtKwh`:

```ts
/** A number with exactly `digits` decimals in the locale's notation: "3.1", "1.15". */
export function fmtDecimal(n: number, digits: number, locale: Locale): string {
  return n.toLocaleString(TAGS[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
```

`src/lib/quote-sizing.ts`:

```ts
import type { ItemCheck, KitNeeds } from './quote-items'

/** Zone edges as quote value over kit need. Each edge belongs to the lower zone. The gauge runs from 0 to GAUGE_MAX. */
export const SIZING_ZONES = { JUST_MAX: 1.3, ROOMY_MAX: 2, GAUGE_MAX: 2.5 } as const
/** Headroom a suggested inverter keeps over the kit's running load. */
const SUGGEST_HEADROOM = 1.15
/** Inverters usually surge to about twice their rating. */
const TYPICAL_SURGE_FACTOR = 2
const SUGGEST_STEP_W = 500
const PERCENT = 100

export type SizingZone = 'short' | 'just' | 'roomy' | 'over'
export type SizedId = 'inverter' | 'battery'
export const SIZED_IDS: readonly SizedId[] = ['inverter', 'battery']
/** One component against the kit: what the quote offers, what the kit needs, and where that lands. */
export interface Sizing { have: number; need: number; ratio: number; zone: SizingZone; pos: number }
export interface QuoteSizing { inverter: Sizing | null; battery: Sizing | null }

/** Value over need, or null when the quote states no size or the kit needs nothing. */
export function sizingRatio(have: number | undefined, need: number): number | null {
  if (have === undefined || !(need > 0)) return null
  return have / need
}

export function sizingZone(ratio: number): SizingZone {
  if (ratio < 1) return 'short'
  if (ratio <= SIZING_ZONES.JUST_MAX) return 'just'
  if (ratio <= SIZING_ZONES.ROOMY_MAX) return 'roomy'
  return 'over'
}

/** Where a ratio sits on the gauge, in percent of its width. */
export function gaugePos(ratio: number): number {
  return Math.min(PERCENT, Math.max(0, (ratio / SIZING_ZONES.GAUGE_MAX) * PERCENT))
}

const roundTenth = (n: number): number => Math.round(n * 10) / 10
const EDGES = [0, 1, SIZING_ZONES.JUST_MAX, SIZING_ZONES.ROOMY_MAX, SIZING_ZONES.GAUGE_MAX]
const ZONE_ORDER: readonly SizingZone[] = ['short', 'just', 'roomy', 'over']
/** Each zone's share of the gauge, in percent. */
export const GAUGE_ZONES: readonly { zone: SizingZone; width: number }[] = ZONE_ORDER.map((zone, i) => ({
  zone, width: roundTenth(gaugePos(EDGES[i + 1]!) - gaugePos(EDGES[i]!)),
}))
export const NEED_POS = gaugePos(1)

function sizing(c: ItemCheck | undefined, have: number | undefined, need: number): Sizing | null {
  if (c === undefined || c.status === 'missing') return null
  const ratio = sizingRatio(have, need)
  if (ratio === null || have === undefined) return null
  return { have, need, ratio, zone: sizingZone(ratio), pos: gaugePos(ratio) }
}

/** The inverter's running watts and the battery's usable energy against the kit. A component that isn't stated, or isn't included, is null. */
export function quoteSizing(items: readonly ItemCheck[], kit: KitNeeds): QuoteSizing {
  const inverter = items.find((c) => c.id === 'inverter')
  const battery = items.find((c) => c.id === 'battery')
  return {
    inverter: sizing(inverter, inverter?.facts.watts, kit.runningW),
    battery: sizing(battery, battery?.facts.usableWh, kit.usableWh),
  }
}

/** A smaller inverter worth asking for: the next 500 W step above the load plus headroom, and enough to start the kit. */
export function suggestedInverterW(kit: KitNeeds): number {
  const floor = Math.max(kit.runningW * SUGGEST_HEADROOM, kit.surgeW / TYPICAL_SURGE_FACTOR)
  return Math.ceil(floor / SUGGEST_STEP_W) * SUGGEST_STEP_W
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quote-sizing.test.ts src/i18n/format.test.ts`
Expected: PASS. If a `GAUGE_ZONES` width comes out as 12.000000001, `roundTenth` is missing.

- [ ] **Step 5: Type check and commit**

```bash
npm run typecheck
git add src/lib/quote-sizing.ts src/lib/quote-sizing.test.ts src/i18n/format.ts src/i18n/format.test.ts
git commit -m "feat: size each quote's inverter and battery against the kit, in zones"
```

---

### Task 2: Text builders, subtitle and EN/ES strings

**Files:**
- Modify:
  - `src/lib/quote-text.ts`
  - `src/lib/quote-compare.ts` (add `quoteSubtitle` after `quoteName`)
  - `src/i18n/quotes-en.ts`, `src/i18n/quotes-es.ts`
  - `src/i18n/types.ts`, `src/i18n/en.ts`, `src/i18n/es.ts`
- Test:
  - `src/lib/quote-text.test.ts`
  - `src/lib/quote-compare.test.ts`
  - `src/i18n/i18n.test.ts`

**Interfaces:**
- Consumes: Task 1's `Sizing`, `SizedId`, `SizingZone`, `GAUGE_ZONES`, `SIZING_ZONES`, `sizingZone`, `gaugePos`, `quoteSizing`, `suggestedInverterW`, and `fmtDecimal`.
- Produces (`src/lib/quote-text.ts`):
  ```ts
  export function zoneName(t: Dictionary, zone: SizingZone): string
  export function zonePill(t: Dictionary, s: Sizing): string
  export function ratioLabel(t: Dictionary, ratio: number): string
  export function gaugeTitle(t: Dictionary, id: SizedId, s: Sizing): string
  export function gaugeLabel(t: Dictionary, id: SizedId, s: Sizing): string
  export function gaugeLegend(t: Dictionary): string
  export function oversizeTip(t: Dictionary, kit: KitNeeds): string
  export type CoverageKind = 'ok' | 'short' | 'missing' | 'unknown'
  export function coverageLines(t: Dictionary, items: readonly ItemCheck[]): { kind: CoverageKind; text: string }[]
  export function deltaText(t: Dictionary, r: RankedQuote): string           // changed wording
  export function unrankedTitle(t: Dictionary, unranked: readonly UnrankedQuote[]): string
  ```
  `src/lib/quote-compare.ts`: `export function quoteSubtitle(q: QuoteView): string | null`
- New dictionary keys, used by later tasks: `kitNeedsTitle`, `needInverter`, `needBattery` and `checksOf`, plus `showChecks` and `hideChecks` with new values and no `{name}`. Dictionary map: `quoteItemsList: Record<ItemId, string>`.
- **Keep for now:** `nextFitGap`, `onlyFit`, `priceAndFit`, `plotHelp`, `plotRule` and `plotPoint`. Tasks 4 and 6 remove them together with their last users.

- [ ] **Step 1: Write the failing tests**

In `src/lib/quote-text.test.ts`:

1. Extend the imports:

```ts
import { fmtDecimal, fmtList, fmtW } from '../i18n/format'
import { compareQuotes, type QuoteView, type RankedQuote, type UnrankedQuote, type UnrankedReason } from './quote-compare'
import { gaugePos, GAUGE_ZONES, quoteSizing, sizingZone, type Sizing } from './quote-sizing'
// and add to the './quote-text' import:
//   coverageLines, gaugeLabel, gaugeLegend, gaugeTitle, money, oversizeTip, ratioLabel, unrankedTitle, zoneName, zonePill
```

2. Replace the existing `deltaText` expectations (the three lines that now expect `'+$820 vs best'`, `'−$330 vs best'` and `''`) with:

```ts
    expect(deltaText(en, voltia)).toBe('$820 more than the best')
    expect(deltaText(en, grupoluz)).toBe('$330 less than the best')
    expect(deltaText(en, solartec)).toBe('')
    expect(deltaText(es, voltia)).toBe(`${money(es, 820, 'USD')} más que la mejor`)
```

3. Append:

```ts
const at = (ratio: number): Sizing => ({ have: ratio * 1000, need: 1000, ratio, zone: sizingZone(ratio), pos: gaugePos(ratio) })

describe('sizing text', () => {
  const sol = quoteSizing(solartec.items, KIT)
  const ener = quoteSizing(enerhogar.items, KIT)

  test('zone names are short enough for the gauge, in both languages', () => {
    expect(GAUGE_ZONES.map((z) => zoneName(en, z.zone))).toEqual(['Short', 'Snug', 'Roomy', 'Oversized'])
    expect(GAUGE_ZONES.map((z) => zoneName(es, z.zone))).toEqual(['Falta', 'Justo', 'Holgado', 'De más'])
  })
  test('the pill says how far from the need, per zone', () => {
    expect(zonePill(en, at(3.1088))).toBe('3.1× what it needs')
    expect(zonePill(en, at(2.01))).toBe('2.0× what it needs')
    expect(zonePill(en, at(1.6))).toBe('+60%, with room to spare')
    expect(zonePill(en, at(1.19))).toBe('+19%, right-sized')
    expect(zonePill(en, at(1.004))).toBe('Exactly what it needs')
    expect(zonePill(en, at(0.996))).toBe('99% of what it needs')
    expect(zonePill(en, at(0.476))).toBe('47% of what it needs')
    expect(zonePill(es, at(1.19))).toBe('+19 %, a la medida')
    expect(zonePill(es, at(0.476))).toBe('47 % de lo necesario')
    expect(zonePill(es, at(3.1088))).toBe(`${fmtDecimal(3.1088, 1, 'es')}× lo necesario`)
  })
  test('the mini bar label is a multiple from 1×, a percent below', () => {
    expect(ratioLabel(en, 1.15)).toBe('1.15×')
    expect(ratioLabel(en, 0.476)).toBe('47%')
    expect(ratioLabel(es, 0.476)).toBe('47 %')
  })
  test('gauge title and accessible name', () => {
    expect(gaugeTitle(en, 'inverter', sol.inverter!)).toBe('Inverter 12.0 kW')
    expect(gaugeTitle(en, 'battery', sol.battery!)).toBe('Battery 34.8 kWh usable')
    expect(gaugeLabel(en, 'inverter', sol.inverter!)).toBe('Inverter: 12.0 kW against 3,860 W needed, oversized')
    expect(gaugeLabel(en, 'battery', ener.battery!)).toBe('Battery: 1.1 kWh against 8.0 kWh needed, short')
    expect(gaugeLabel(es, 'inverter', sol.inverter!)).toBe(`Inversor: ${fmtW(12000, 'es')} frente a ${fmtW(3860, 'es')} necesarios, de más`)
  })
  test('the legend takes its numbers from the zone constants', () => {
    expect(gaugeLegend(en)).toBe('Snug: up to 30% more than your kit uses. Oversized: more than double.')
    expect(gaugeLegend(es)).toBe('Justo: hasta 30 % más de lo que usa tu kit. De más: más del doble.')
  })
  test('the oversize tip suggests a size that still starts the kit', () => {
    expect(oversizeTip(en, KIT)).toBe("The inverter is more than double what your kit uses. Ask whether there's a 5,000 W version: it usually costs less.")
    expect(oversizeTip(es, KIT)).toBe(`El inversor es más del doble de lo que usa tu kit. Pregunta si hay una versión de ${fmtW(5000, 'es')}: suele bajar el precio.`)
  })
})

describe('coverageLines', () => {
  test('groups the five strip items by status, leaving out empty groups', () => {
    expect(coverageLines(en, grupoluz.items)).toEqual([
      { kind: 'ok', text: `Includes ${fmtList(['cables', 'installation'], 'en')}` },
      { kind: 'unknown', text: `Doesn't mention ${fmtList(['charger', 'Wi-Fi', 'fuse'], 'en')}` },
    ])
    expect(coverageLines(en, enerhogar.items)).toEqual([
      { kind: 'ok', text: `Includes ${fmtList(['charger', 'installation'], 'en')}` },
      { kind: 'short', text: 'Too small: cables' },
      { kind: 'missing', text: 'Not included: Wi-Fi' },
      { kind: 'unknown', text: "Doesn't mention fuse" },
    ])
  })
  test('in Spanish', () => {
    expect(coverageLines(es, grupoluz.items).map((l) => l.text)).toEqual([
      `Incluye ${fmtList(['cables', 'instalación'], 'es')}`,
      `No menciona ${fmtList(['cargador', 'Wi-Fi', 'fusible'], 'es')}`,
    ])
  })
})

describe('unrankedTitle', () => {
  const u = (reason: UnrankedReason): UnrankedQuote => ({ quote: view('solartec', 0), name: 'X', reason, currency: 'USD' })
  test('says "without a total" only when every unranked quote waits for one', () => {
    expect(unrankedTitle(en, [u('no_total'), u('needs_review')])).toBe("Without a total, these can't be compared")
    expect(unrankedTitle(es, [u('no_total')])).toBe('Sin total, no se pueden comparar')
    expect(unrankedTitle(en, [u('no_total'), u('failed')])).toBe('Not compared yet')
    expect(unrankedTitle(es, [u('reading')])).toBe('Aún sin comparar')
  })
})
```

In `src/lib/quote-compare.test.ts`, add `quoteSubtitle` to the `./quote-compare` import and append:

```ts
describe('quoteSubtitle', () => {
  test('is the file name when the shown name comes from the vendor or a label', () => {
    expect(quoteSubtitle(view('solartec'))).toBe('solartec.pdf')
    expect(quoteSubtitle(view('solartec', { label: 'Roof job' }))).toBe('solartec.pdf')
  })
  test('is null when the shown name already is the file name', () => {
    expect(quoteSubtitle(view('unknown-vendor', { extraction: null }))).toBeNull()
  })
})
```

In `src/i18n/i18n.test.ts`, change the item-map loop to cover the new map:

```ts
      for (const map of [d.quoteItems, d.quoteItemsInline, d.quoteItemsShort, d.quoteItemsList]) {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quote-text.test.ts src/lib/quote-compare.test.ts src/i18n/i18n.test.ts`
Expected: FAIL. The new exports are missing, `quoteItemsList` is undefined, and `deltaText` returns the old wording.

- [ ] **Step 3: Add the strings**

In `src/i18n/quotes-en.ts`, inside `quotesEn`:
- delete `vsBest`;
- change `showChecks` and `hideChecks` to the values below;
- add the new keys after `othersTitle`/`allTitle`.

```ts
  lessThanBest: '{amount} less than the best',
  moreThanBest: '{amount} more than the best',
  unrankedNoTotal: "Without a total, these can't be compared",
  unrankedTitle: 'Not compared yet',
  kitNeedsTitle: 'What your kit needs',
  needInverter: 'Inverter, your kit',
  needBattery: 'Usable battery, your kit',
  gaugeInverter: 'Inverter {w}',
  gaugeBattery: 'Battery {kwh} usable',
  gaugeLabel: '{item}: {have} against {need} needed, {zone}',
  gaugeLegend: 'Snug: up to {pct}% more than your kit uses. Oversized: more than double.',
  zoneShort: 'Short',
  zoneJust: 'Snug',
  zoneRoomy: 'Roomy',
  zoneOver: 'Oversized',
  pillShort: '{pct}% of what it needs',
  pillJust: '+{pct}%, right-sized',
  pillRoomy: '+{pct}%, with room to spare',
  pillOver: '{x}× what it needs',
  pillExact: 'Exactly what it needs',
  ratioPct: '{pct}%',
  ratioTimes: '{x}×',
  oversizeTip: "The inverter is more than double what your kit uses. Ask whether there's a {w} version: it usually costs less.",
  coverIncludes: 'Includes {items}',
  coverShort: 'Too small: {items}',
  coverMissing: 'Not included: {items}',
  coverUnknown: "Doesn't mention {items}",
  checksOf: 'for {name}',
```

```ts
  showChecks: 'Show checks',
  hideChecks: 'Hide checks',
```

After `quoteItemsShortEn`:

```ts
/** Item names in a comma list after "Includes" or "Doesn't mention". */
export const quoteItemsListEn: Record<ItemId, string> = {
  inverter: 'inverter', battery: 'battery', charger: 'charger', wifi: 'Wi-Fi',
  cables: 'cables', fuse: 'fuse', installation: 'installation', warranty: 'warranty',
}
```

In `src/i18n/quotes-es.ts`, make the same changes:

```ts
  lessThanBest: '{amount} menos que la mejor',
  moreThanBest: '{amount} más que la mejor',
  unrankedNoTotal: 'Sin total, no se pueden comparar',
  unrankedTitle: 'Aún sin comparar',
  kitNeedsTitle: 'Lo que necesita tu kit',
  needInverter: 'Inversor, tu kit',
  needBattery: 'Batería útil, tu kit',
  gaugeInverter: 'Inversor {w}',
  gaugeBattery: 'Batería {kwh} útiles',
  gaugeLabel: '{item}: {have} frente a {need} necesarios, {zone}',
  gaugeLegend: 'Justo: hasta {pct} % más de lo que usa tu kit. De más: más del doble.',
  zoneShort: 'Falta',
  zoneJust: 'Justo',
  zoneRoomy: 'Holgado',
  zoneOver: 'De más',
  pillShort: '{pct} % de lo necesario',
  pillJust: '+{pct} %, a la medida',
  pillRoomy: '+{pct} %, con margen',
  pillOver: '{x}× lo necesario',
  pillExact: 'Justo lo necesario',
  ratioPct: '{pct} %',
  ratioTimes: '{x}×',
  oversizeTip: 'El inversor es más del doble de lo que usa tu kit. Pregunta si hay una versión de {w}: suele bajar el precio.',
  coverIncludes: 'Incluye {items}',
  coverShort: 'Insuficiente: {items}',
  coverMissing: 'No incluye {items}',
  coverUnknown: 'No menciona {items}',
  checksOf: 'de {name}',
```

```ts
  showChecks: 'Ver comprobaciones',
  hideChecks: 'Ocultar comprobaciones',
```

```ts
export const quoteItemsListEs: Record<ItemId, string> = {
  inverter: 'inversor', battery: 'batería', charger: 'cargador', wifi: 'Wi-Fi',
  cables: 'cables', fuse: 'fusible', installation: 'instalación', warranty: 'garantía',
}
```

Wire the map:
- In `src/i18n/types.ts`, inside `Dictionary`, after `quoteItemsShort`:

  ```ts
  /** Item names in a comma list: "Includes charger, Wi-Fi and installation". */
  quoteItemsList: Record<ItemId, string>
  ```

- In `src/i18n/en.ts`, import `quoteItemsListEn` and add `quoteItemsList: quoteItemsListEn,` after `quoteItemsShort`.
- In `src/i18n/es.ts`, do the same with `quoteItemsListEs`.

- [ ] **Step 4: Implement the builders**

In `src/lib/quote-compare.ts`, after `quoteName`:

```ts
/** A second line that tells same-vendor quotes apart: the file name, unless it already is the shown name. */
export function quoteSubtitle(q: QuoteView): string | null {
  return quoteName(q) === q.fileName ? null : q.fileName
}
```

In `src/lib/quote-text.ts`:
- Change the format import to `import { fmtDecimal, fmtKwh, fmtList, fmtMoney, fmtW } from '../i18n/format'`.
- Change the i18n import to `import { trq, type Dictionary, type QuoteKey } from '../i18n'`.
- Add `type UnrankedQuote` to the `./quote-compare` import.
- Change the `./quote-items` import to `import { STRIP_ITEMS, type ItemCheck, type ItemId, type ItemStatus, type KitNeeds } from './quote-items'`.
- Add `import { SIZING_ZONES, suggestedInverterW, type SizedId, type Sizing, type SizingZone } from './quote-sizing'`.
- Delete `signedMoney`, and replace `deltaText`:

```ts
export function deltaText(t: Dictionary, r: RankedQuote): string {
  if (r.delta === null || r.delta === 0) return ''
  return trq(t, r.delta > 0 ? 'moreThanBest' : 'lessThanBest', { amount: money(t, Math.abs(r.delta), r.currency) })
}
```

Append:

```ts
const PERCENT = 100
const ZONE_KEY: Record<SizingZone, QuoteKey> = { short: 'zoneShort', just: 'zoneJust', roomy: 'zoneRoomy', over: 'zoneOver' }
/** Short percents round down, so a quote just under the need never reads as 100 %. */
const shortPct = (ratio: number): number => Math.floor(ratio * PERCENT)
const sizedAmount = (t: Dictionary, id: SizedId, n: number): string => (id === 'inverter' ? fmtW(n, t.locale) : fmtKwh(n, t.locale))

export const zoneName = (t: Dictionary, zone: SizingZone): string => t.quotes[ZONE_KEY[zone]]

/** How far a component lands from the kit's need: "3.1× what it needs", "+19%, right-sized", "47% of what it needs". */
export function zonePill(t: Dictionary, s: Sizing): string {
  if (s.zone === 'short') return trq(t, 'pillShort', { pct: shortPct(s.ratio) })
  if (s.zone === 'over') return trq(t, 'pillOver', { x: fmtDecimal(s.ratio, 1, t.locale) })
  const extra = Math.round((s.ratio - 1) * PERCENT)
  if (extra === 0) return t.quotes.pillExact
  return trq(t, s.zone === 'just' ? 'pillJust' : 'pillRoomy', { pct: extra })
}

/** The value beside a mini bar: a multiple from 1×, a percent below. */
export function ratioLabel(t: Dictionary, ratio: number): string {
  return ratio < 1 ? trq(t, 'ratioPct', { pct: shortPct(ratio) }) : trq(t, 'ratioTimes', { x: fmtDecimal(ratio, 2, t.locale) })
}

export function gaugeTitle(t: Dictionary, id: SizedId, s: Sizing): string {
  return id === 'inverter' ? trq(t, 'gaugeInverter', { w: fmtW(s.have, t.locale) }) : trq(t, 'gaugeBattery', { kwh: fmtKwh(s.have, t.locale) })
}

/** The gauge's accessible name: the numbers and the zone in words. */
export function gaugeLabel(t: Dictionary, id: SizedId, s: Sizing): string {
  return trq(t, 'gaugeLabel', {
    item: t.quoteItemsShort[id], have: sizedAmount(t, id, s.have), need: sizedAmount(t, id, s.need),
    zone: zoneName(t, s.zone).toLocaleLowerCase(t.locale),
  })
}

export function gaugeLegend(t: Dictionary): string {
  return trq(t, 'gaugeLegend', { pct: Math.round((SIZING_ZONES.JUST_MAX - 1) * PERCENT) })
}

export function oversizeTip(t: Dictionary, kit: KitNeeds): string {
  return trq(t, 'oversizeTip', { w: fmtW(suggestedInverterW(kit), t.locale) })
}

/** ok, short, missing, unknown: one coverage line per item status. */
export type CoverageKind = ItemStatus
const COVERAGE: readonly { kind: CoverageKind; key: QuoteKey }[] = [
  { kind: 'ok', key: 'coverIncludes' }, { kind: 'short', key: 'coverShort' },
  { kind: 'missing', key: 'coverMissing' }, { kind: 'unknown', key: 'coverUnknown' },
]

/** What a quote says about the five strip items, one line per status, empty groups left out. */
export function coverageLines(t: Dictionary, items: readonly ItemCheck[]): { kind: CoverageKind; text: string }[] {
  const strip = items.filter((c) => STRIP_ITEMS.includes(c.id))
  return COVERAGE.flatMap(({ kind, key }) => {
    const ids: ItemId[] = strip.filter((c) => c.status === kind).map((c) => c.id)
    if (ids.length === 0) return []
    return [{ kind, text: trq(t, key, { items: fmtList(ids.map((id) => t.quoteItemsList[id]), t.locale) }) }]
  })
}

const waitsForTotal = (u: UnrankedQuote): boolean => u.reason === 'no_total' || u.reason === 'needs_review'

export function unrankedTitle(t: Dictionary, unranked: readonly UnrankedQuote[]): string {
  return unranked.length > 0 && unranked.every(waitsForTotal) ? t.quotes.unrankedNoTotal : t.quotes.unrankedTitle
}
```

- [ ] **Step 5: Run the tests, the whole suite and the type check**

Run:

```bash
npx vitest run src/lib/quote-text.test.ts src/lib/quote-compare.test.ts src/i18n/i18n.test.ts
npm test
npm run typecheck
```

Expected:
- PASS.
- Typecheck passes too. `BestCard` and `QuoteRow` still call `trq(t, 'showChecks', { name })`, and an unused param is allowed.
- If any test elsewhere asserted `vs best` or the old `showChecks` text, update it to the new wording.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quote-text.ts src/lib/quote-text.test.ts src/lib/quote-compare.ts src/lib/quote-compare.test.ts src/i18n/quotes-en.ts src/i18n/quotes-es.ts src/i18n/types.ts src/i18n/en.ts src/i18n/es.ts src/i18n/i18n.test.ts
git commit -m "feat: words for sizing zones, coverage and gaps to the best quote, in English and Spanish"
```

---

### Task 3: Gauge, bars, kit tiles and the checks toggle

There are no component unit tests in this repo: Vitest runs in node on `src/**/*.test.ts`. These components are checked by typecheck here and by E2E in Task 7. Keep all logic in Tasks 1–2 helpers.

**Files:**
- Create:
  - `src/components/quotes/SizingGauge.tsx`
  - `src/components/quotes/SizingBars.tsx`
  - `src/components/quotes/KitNeedTiles.tsx`
  - `src/components/quotes/ChecksToggle.tsx`
- Modify: `src/styles/quotes.css`
  - Add a `/* Sizing */` block right after the `.qpanel__title` rule.
  - Add `.qpill--info` after `.qpill--run`.
  - Add `.qchecks` to the `:focus-visible` list.

**Interfaces:**
- Consumes:
  - Task 1: `Sizing`, `SizedId`, `SIZED_IDS`, `QuoteSizing`, `GAUGE_ZONES`, `NEED_POS`.
  - Task 2: `zoneName`, `zonePill`, `gaugeTitle`, `gaugeLabel`, `ratioLabel`, and the `kitNeedsTitle`, `needInverter`, `needBattery`, `showChecks`, `hideChecks` and `checksOf` keys.
  - `fmtW`, `fmtKwh` from `src/i18n/format.ts`.
  - `.visually-hidden` from `src/styles/base.css`.
- Produces:
  ```tsx
  export function SizingGauge(props: { id: SizedId; s: Sizing }): JSX.Element
  export function SizingBars(props: { sizing: QuoteSizing }): JSX.Element | null
  export function KitNeedTiles(props: { kit: KitNeeds }): JSX.Element
  export function ChecksToggle(props: { name: string; isOpen: boolean; controls: string; onToggle: () => void; variant: 'button' | 'link' }): JSX.Element
  ```
  - `ChecksToggle`'s accessible name is "Show checks for {name}" / "Hide checks for {name}". The visible text is "Show checks" / "Hide checks".

- [ ] **Step 1: `SizingGauge.tsx`**

```tsx
import { useLocale } from '../../hooks/useLocale'
import { GAUGE_ZONES, type SizedId, type Sizing, type SizingZone } from '../../lib/quote-sizing'
import { gaugeLabel, gaugeTitle, zoneName, zonePill } from '../../lib/quote-text'

const PILL: Record<SizingZone, string> = { short: 'qpill qpill--warn', just: 'qpill qpill--ok', roomy: 'qpill qpill--unk', over: 'qpill qpill--info' }
const COLUMNS = GAUGE_ZONES.map((z) => `${z.width}fr`).join(' ')

/** One component against the kit: a four-zone bar with a marker, and the zone named in words. */
export function SizingGauge({ id, s }: { id: SizedId; s: Sizing }) {
  const { t } = useLocale()
  return (
    <div className="qgauge">
      <div className="qgauge__head">
        <span className="qgauge__title num">{gaugeTitle(t, id, s)}</span>
        <span className={PILL[s.zone]}>{zonePill(t, s)}</span>
      </div>
      <div className="qgauge__scale" role="img" aria-label={gaugeLabel(t, id, s)}>
        <div className="qgauge__bar" style={{ gridTemplateColumns: COLUMNS }}>
          {GAUGE_ZONES.map((z) => <span key={z.zone} className={`qgauge__z qgauge__z--${z.zone}`} />)}
        </div>
        <svg className="qgauge__marker" style={{ left: `${s.pos}%` }} width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
          <path d="M7 12 0 0h14z" fill="currentColor" />
        </svg>
        <div className="qgauge__names" style={{ gridTemplateColumns: COLUMNS }} aria-hidden="true">
          {GAUGE_ZONES.map((z) => (
            <span key={z.zone} className={z.zone === s.zone ? `qgauge__name qgauge__name--on qgauge__name--${z.zone}` : 'qgauge__name'}>
              {zoneName(t, z.zone)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `SizingBars.tsx`**

```tsx
import { Fragment } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { NEED_POS, SIZED_IDS, type QuoteSizing } from '../../lib/quote-sizing'
import { gaugeLabel, ratioLabel } from '../../lib/quote-text'

/** Inverter and battery as small bars, with a tick where the kit's need sits. Screen readers get the same as one sentence. */
export function SizingBars({ sizing }: { sizing: QuoteSizing }) {
  const { t } = useLocale()
  const rows = SIZED_IDS.flatMap((id) => {
    const s = sizing[id]
    return s ? [{ id, s }] : []
  })
  if (rows.length === 0) return null
  return (
    <>
      <div className="qbars" aria-hidden="true">
        {rows.map(({ id, s }) => (
          <Fragment key={id}>
            <span className="qmeta">{t.quoteItemsShort[id]}</span>
            <span className="qbars__track">
              <span className={`qbars__fill qbars__fill--${s.zone}`} style={{ width: `${s.pos}%` }} />
              <span className="qbars__tick" style={{ left: `${NEED_POS}%` }} />
            </span>
            <span className={`qbars__val qbars__val--${s.zone} num`}>{ratioLabel(t, s.ratio)}</span>
          </Fragment>
        ))}
      </div>
      <p className="visually-hidden">{rows.map(({ id, s }) => gaugeLabel(t, id, s)).join('. ')}</p>
    </>
  )
}
```

- [ ] **Step 3: `KitNeedTiles.tsx`**

```tsx
import { useLocale } from '../../hooks/useLocale'
import { fmtKwh, fmtW } from '../../i18n/format'
import type { KitNeeds } from '../../lib/quote-items'

/** What every quote is measured against: the kit's running load and the usable energy it needs. */
export function KitNeedTiles({ kit }: { kit: KitNeeds }) {
  const { t } = useLocale()
  return (
    <section className="qneeds" aria-label={t.quotes.kitNeedsTitle}>
      <div className="qneed">
        <span className="qmeta">{t.quotes.needInverter}</span>
        <span className="qneed__value num">{fmtW(kit.runningW, t.locale)}</span>
      </div>
      <div className="qneed">
        <span className="qmeta">{t.quotes.needBattery}</span>
        <span className="qneed__value num">{fmtKwh(kit.usableWh, t.locale)}</span>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: `ChecksToggle.tsx`**

```tsx
import { ChevronDown } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'

interface Props { name: string; isOpen: boolean; controls: string; onToggle: () => void; variant: 'button' | 'link' }

/** Show or hide a quote's checks. The quote's name is in the accessible name but hidden, so the visible label stays short. */
export function ChecksToggle({ name, isOpen, controls, onToggle, variant }: Props) {
  const { t } = useLocale()
  return (
    <button type="button" className={variant === 'button' ? 'qbtn qchecks' : 'qlink qchecks'} aria-expanded={isOpen}
      aria-controls={controls} onClick={onToggle}>
      {isOpen ? t.quotes.hideChecks : t.quotes.showChecks}{' '}
      <span className="visually-hidden">{trq(t, 'checksOf', { name })}</span>
      <ChevronDown size={16} aria-hidden="true" className="qchecks__chev" />
    </button>
  )
}
```

- [ ] **Step 5: CSS**

Add these to `src/styles/quotes.css`:

1. After `.qpill--run`:

```css
.qpill--info { background: var(--accent-tint); color: var(--accent-hover); }
```

2. In the `:is(...):focus-visible` selector list, add `.qchecks`.

3. Right after the `.qpanel__title` rule:

```css
/* Sizing: a zone is the quote's value over the kit's need; zone widths come from GAUGE_ZONES as grid columns. */
.qv { --qz-short: #FFE3B0; --qz-just: #BFE3CD; --qz-roomy: #D5DAE2; --qz-over: #AEBCF6; --qz-short-fill: #C98A12; }
.qneeds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; max-width: 520px; }
.qneed { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); }
.qneed__value { font-family: var(--font-display); font-size: 22px; font-weight: 700; }
.qgauge { display: flex; flex-direction: column; gap: 8px; }
.qgauge__head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px 8px; }
.qgauge__title { font-weight: 600; }
.qgauge__scale { position: relative; padding-top: 16px; }
.qgauge__bar, .qgauge__names { display: grid; gap: 3px; }
.qgauge__bar { height: 10px; }
.qgauge__z:first-child { border-radius: 999px 0 0 999px; }
.qgauge__z:last-child { border-radius: 0 999px 999px 0; }
.qgauge__z--short { background: var(--qz-short); }
.qgauge__z--just { background: var(--qz-just); }
.qgauge__z--roomy { background: var(--qz-roomy); }
.qgauge__z--over { background: var(--qz-over); }
.qgauge__marker { position: absolute; top: 0; transform: translateX(-50%); color: var(--ink); }
.qgauge__names { margin-top: 6px; font-size: 11px; line-height: 1.2; color: var(--muted); }
.qgauge__name { min-width: 0; white-space: nowrap; }
.qgauge__name--on { font-weight: 700; }
.qgauge__name--short { color: var(--warn-ink); }
.qgauge__name--just { color: var(--success); }
.qgauge__name--roomy { color: var(--ink); }
.qgauge__name--over { color: var(--accent-hover); }
.qbars { display: grid; grid-template-columns: 72px minmax(0, 1fr) 56px; gap: 6px 10px; align-items: center; font-size: 13px; }
.qbars__track { position: relative; height: 8px; border-radius: 999px; background: var(--fill); }
.qbars__fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px; }
.qbars__fill--short { background: var(--qz-short-fill); }
.qbars__fill--just, .qbars__fill--roomy { background: var(--success); }
.qbars__fill--over { background: var(--accent); }
.qbars__tick { position: absolute; top: -4px; width: 2px; height: 16px; border-radius: 1px; background: var(--ink); transform: translateX(-50%); }
.qbars__val { text-align: right; font-weight: 600; }
.qbars__val--short { color: var(--warn-ink); }
.qbars__val--just, .qbars__val--roomy { color: var(--success); }
.qbars__val--over { color: var(--accent-hover); }
.qchecks__chev { transition: transform 160ms; }
.qchecks[aria-expanded='true'] .qchecks__chev { transform: rotate(180deg); }
```

4. In the `@media (prefers-reduced-motion: reduce)` block, add `.qchecks__chev` to the `transition: none` selector list.

- [ ] **Step 6: Type check and commit**

Run: `npm run typecheck && npm test`
Expected: PASS. The components aren't mounted yet.

```bash
git add src/components/quotes/SizingGauge.tsx src/components/quotes/SizingBars.tsx src/components/quotes/KitNeedTiles.tsx src/components/quotes/ChecksToggle.tsx src/styles/quotes.css
git commit -m "feat: sizing gauge, sizing bars, kit tiles and a shared checks toggle for the verdict page"
```

---

### Task 4: Best card

**Files:**
- Modify:
  - `src/components/quotes/BestCard.tsx` (full rewrite below)
  - `src/components/quotes/VerdictView.tsx` (only the `<BestCard …>` call: drop `nextFit`)
  - `src/i18n/quotes-en.ts`, `quotes-es.ts` (delete `nextFitGap` and `onlyFit`)
  - `src/styles/quotes.css`

**Interfaces:**
- Consumes:
  - Task 1: `quoteSizing`, `SIZED_IDS`.
  - Task 2: `quoteSubtitle`, `gaugeLegend`, `oversizeTip`, `coverageLines`, `CoverageKind`.
  - Task 3: `SizingGauge`, `ChecksToggle`.
  - Existing: `ItemList`, `QuoteActions`, `money`.
- Produces: `BestCard` props `{ best: RankedQuote; kit: KitNeeds; error: string | null; onOverride: (item: ItemId, value: Override | null) => void; onDelete: () => void }`.
  - It is still a `<section aria-labelledby>`, so `getByRole('region', { name: best.name })` works.
  - The text `Best fit` stays visible.
- Shared CSS classes that Task 5 reuses: `.qcard__top`, `.qcard__id`, `.qcard__name`, `.qcard__sub`.

- [ ] **Step 1: Rewrite `BestCard.tsx`**

```tsx
import { Info } from 'lucide-react'
import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { quoteSubtitle, type RankedQuote } from '../../lib/quote-compare'
import type { ItemId, KitNeeds, Override } from '../../lib/quote-items'
import { quoteSizing, SIZED_IDS } from '../../lib/quote-sizing'
import { coverageLines, gaugeLegend, money, oversizeTip, type CoverageKind } from '../../lib/quote-text'
import { ChecksToggle } from './ChecksToggle'
import { ItemList } from './ItemList'
import { QuoteActions } from './QuoteActions'
import { SizingGauge } from './SizingGauge'

/** The words carry the meaning; the mark only repeats it at a glance. */
const MARK: Record<CoverageKind, string> = { ok: '✓', short: '!', missing: '!', unknown: '?' }

interface Props {
  best: RankedQuote; kit: KitNeeds; error: string | null
  onOverride: (item: ItemId, value: Override | null) => void
  onDelete: () => void
}

export function BestCard({ best, kit, error, onOverride, onDelete }: Props) {
  const { t } = useLocale()
  const [isOpen, setOpen] = useState(false)
  const titleId = useId()
  const bodyId = useId()
  const sizing = quoteSizing(best.items, kit)
  const gauges = SIZED_IDS.flatMap((id) => {
    const s = sizing[id]
    return s ? [{ id, s }] : []
  })
  const subtitle = quoteSubtitle(best.quote)
  return (
    <section className="qpanel qpanel--best" aria-labelledby={titleId}>
      <span className="qpill qpill--best qbest__pill">{t.quotes.bestFit}</span>
      <div className="qcard__top">
        <div className="qcard__id">
          <h2 className="qpanel__title qcard__name" id={titleId}>{best.name}</h2>
          {subtitle && <p className="qmeta qcard__sub">{subtitle}</p>}
        </div>
        <p className="qbest__total num">{money(t, best.total, best.currency)}</p>
      </div>
      {gauges.length > 0 && (
        <div className="qbest__gauges">
          {gauges.map(({ id, s }) => <SizingGauge key={id} id={id} s={s} />)}
          <p className="qmeta">{gaugeLegend(t)}</p>
        </div>
      )}
      {sizing.inverter?.zone === 'over' && (
        <p className="qtip"><Info size={18} aria-hidden="true" /><span>{oversizeTip(t, kit)}</span></p>
      )}
      <ul className="qcover">
        {coverageLines(t, best.items).map((l) => (
          <li key={l.kind} className={`qcover__line qcover__line--${l.kind}`}>
            <span className="qcover__mark" aria-hidden="true">{MARK[l.kind]}</span>{l.text}
          </li>
        ))}
      </ul>
      <div className="qbest__actions">
        <ChecksToggle name={best.name} isOpen={isOpen} controls={bodyId} onToggle={() => setOpen(!isOpen)} variant="button" />
        <QuoteActions quoteId={best.quote.id} onDelete={onDelete} />
      </div>
      {isOpen && <div id={bodyId}><ItemList items={best.items} kit={kit} currency={best.currency} onOverride={onOverride} /></div>}
      {error && <p className="qerr" role="alert">{error}</p>}
    </section>
  )
}
```

- [ ] **Step 2: Update the call in `VerdictView.tsx`**

Replace `<BestCard best={verdict.best} nextFit={verdict.nextFit} kit={kit} …` with `<BestCard best={verdict.best} kit={kit} …`. Keep the other props as they are.

- [ ] **Step 3: Delete the dead keys**

Remove `nextFitGap` and `onlyFit` from `quotesEn` and `quotesEs`. Run `rg -n "nextFitGap|onlyFit" src e2e`. Expected: no matches.

- [ ] **Step 4: CSS**

In `src/styles/quotes.css`:
- Replace the `.qbest__top`, `.qbest__top .qmeta` and `.qbest__items` / `.qbest__items li` rules with the block below.
- Keep `.qbest__total`, but add `white-space: nowrap; margin: 0;` to it.

```css
.qpanel--best .qpanel__title { font-size: 22px; }
.qbest__pill { align-self: flex-start; }
.qcard__top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.qcard__id { flex: 1 1 auto; min-width: 0; }
.qcard__name, .qcard__sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qcard__sub { margin: 2px 0 0; }
.qbest__gauges { display: flex; flex-direction: column; gap: 18px; }
.qtip { display: flex; gap: 10px; margin: 0; padding: 12px; border-radius: 10px; background: var(--accent-tint); color: var(--accent-hover); font-size: 14px; line-height: 1.45; }
.qtip svg { flex: none; margin-top: 2px; }
.qcover { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.qcover__line { display: flex; gap: 8px; align-items: flex-start; }
.qcover__mark { width: 14px; flex: none; text-align: center; font-weight: 700; }
.qcover__line--ok .qcover__mark { color: var(--success); }
.qcover__line--short, .qcover__line--missing { color: var(--warn-ink); }
.qcover__line--unknown { color: var(--muted); }
.qbest__actions { display: flex; flex-wrap: wrap; gap: 10px; }
.qbest__actions > .qchecks { flex: 1 1 auto; }
```

Then, in the phone block (`@media (max-width: 1023px)`, the one that sets `.qseg__b, .qmust, …`), add:

```css
  .qpanel--best { padding: 18px; }
  .qbest__total { font-size: 28px; }
```

- [ ] **Step 5: Check and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/components/quotes/BestCard.tsx src/components/quotes/VerdictView.tsx src/i18n/quotes-en.ts src/i18n/quotes-es.ts src/styles/quotes.css
git commit -m "feat: best-fit card with a sizing gauge per component and a tip when the inverter is oversized"
```

---

### Task 5: Other ranked cards and the unranked card's top line

**Files:**
- Modify:
  - `src/components/quotes/QuoteRow.tsx` (full rewrite below)
  - `src/components/quotes/UnrankedRow.tsx` (top line only)
  - `src/styles/quotes.css`

**Interfaces:**
- Consumes:
  - Task 1: `quoteSizing`.
  - Task 2: `quoteSubtitle`, `coverageLines`, `deltaText`.
  - Task 3: `SizingBars`, `ChecksToggle`.
  - Task 4: the `.qcard__*` classes.
  - Existing: `AskBox`, `ItemList`, `QuoteActions`, `fitLabel`, `reasonLine`, `money`.
- Produces:
  - `QuoteRow` props are unchanged: `{ r, verdict, kit, error, onOverride, onDelete }`.
  - It is still an `<article aria-labelledby>`.
  - Its name is an `h3`, its total has class `.qrow__total`, and its reason has class `.qrow__reason`. Task 7's phone test relies on these.

- [ ] **Step 1: Rewrite `QuoteRow.tsx`**

```tsx
import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { quoteSubtitle, type RankedQuote, type Verdict } from '../../lib/quote-compare'
import type { ItemId, KitNeeds, Override } from '../../lib/quote-items'
import { quoteSizing } from '../../lib/quote-sizing'
import { coverageLines, deltaText, fitLabel, money, reasonLine } from '../../lib/quote-text'
import { AskBox } from './AskBox'
import { ChecksToggle } from './ChecksToggle'
import { ItemList } from './ItemList'
import { QuoteActions } from './QuoteActions'
import { SizingBars } from './SizingBars'

const PILL: Record<RankedQuote['fit'], string> = { fits: 'qpill qpill--ok', unclear: 'qpill qpill--unk', short: 'qpill qpill--warn' }
const COVERAGE_SEPARATOR = ' · '

interface Props {
  r: RankedQuote; verdict: Verdict; kit: KitNeeds; error: string | null
  onOverride: (item: ItemId, value: Override | null) => void
  onDelete: () => void
}

/** A ranked quote as a stacked card: name and total on one line, then fit, the reason at full width, sizing and coverage. */
export function QuoteRow({ r, verdict, kit, error, onOverride, onDelete }: Props) {
  const { t } = useLocale()
  const [isOpen, setOpen] = useState(false)
  const nameId = useId()
  const bodyId = useId()
  const isAsking = verdict.worthAsking.some((w) => w.quote.id === r.quote.id)
  const delta = deltaText(t, r)
  const subtitle = quoteSubtitle(r.quote)
  const coverage = coverageLines(t, r.items).map((l) => l.text).join(COVERAGE_SEPARATOR)
  return (
    <article className="qrow" aria-labelledby={nameId}>
      <div className="qcard__top">
        <div className="qcard__id">
          <h3 className="qrow__name qcard__name" id={nameId}>{r.name}</h3>
          {subtitle && <p className="qmeta qcard__sub">{subtitle}</p>}
        </div>
        <p className="qrow__total num">{money(t, r.total, r.currency)}</p>
      </div>
      <div className="qrow__fitline">
        <span className={PILL[r.fit]}>{fitLabel(t, r, verdict)}</span>
        {delta && <span className="qmeta num">{delta}</span>}
      </div>
      <p className="qrow__reason">{reasonLine(t, r, verdict, kit)}</p>
      <SizingBars sizing={quoteSizing(r.items, kit)} />
      {coverage && <p className="qmeta">{coverage}</p>}
      {isAsking && <AskBox r={r} verdict={verdict} />}
      <ChecksToggle name={r.name} isOpen={isOpen} controls={bodyId} onToggle={() => setOpen(!isOpen)} variant="link" />
      {isOpen && (
        <div className="qrow__body" id={bodyId}>
          <ItemList items={r.items} kit={kit} currency={r.currency} onOverride={onOverride} />
          <QuoteActions quoteId={r.quote.id} onDelete={onDelete} />
        </div>
      )}
      {error && <p className="qerr" role="alert">{error}</p>}
    </article>
  )
}
```

- [ ] **Step 2: Rework the top line of `UnrankedRow.tsx`**

1. Add `quoteSubtitle` to the imports: `import { quoteSubtitle, type UnrankedQuote } from '../../lib/quote-compare'`.
2. Replace the `qrow__titleline` block:

```tsx
      <div className="qcard__top">
        <div className="qcard__id">
          <h3 className="qrow__name qcard__name" id={nameId}>{u.name}</h3>
          {quoteSubtitle(u.quote) && <p className="qmeta qcard__sub">{quoteSubtitle(u.quote)}</p>}
        </div>
        <span className={pill.cls}>{pill.text}</span>
      </div>
```

   Compute `const subtitle = quoteSubtitle(u.quote)` once, above the `return`, and use `subtitle` in both places.
3. Leave the form and the actions as they are.

- [ ] **Step 3: CSS**

In `src/styles/quotes.css`:

1. Replace the `.qlist__rows`, `.qrow`, `.qrow:first-child`, `.qrow__name`, `.qrow__reason` and `.qrow__total` rules with:

```css
.qlist > .qpanel__title { font-size: 22px; }
.qlist__rows { display: flex; flex-direction: column; gap: 12px; }
.qrow { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); }
.qrow__name { margin: 0; font-family: var(--font-display); font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.qrow__total { margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 700; white-space: nowrap; }
.qrow__fitline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.qrow__reason { margin: 0; font-size: 14.5px; line-height: 1.45; }
.qrow > .qchecks { align-self: flex-start; }
```

2. Change `.qrow__form label` to add `flex: 1 1 160px;`, and change `.qrow__form .in { width: 160px; }` to `.qrow__form .in { width: 100%; }`.

3. Leave `.qrank`, `.qrow__head`, `.qrow__strip`, `.qrow__money`, `.qrow__toggle`, `.qrow__titleline` and `.qrow__delta` for Task 6 to delete. They're unused now but harmless.

- [ ] **Step 4: Check and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/components/quotes/QuoteRow.tsx src/components/quotes/UnrankedRow.tsx src/styles/quotes.css
git commit -m "feat: stacked quote cards with sizing bars, coverage and the gap to the best"
```

---

### Task 6: Verdict wiring, sections, and removing the plot

**Files:**
- Modify:
  - `src/components/quotes/VerdictView.tsx`
  - `src/styles/quotes.css`
  - `src/i18n/quotes-en.ts`, `quotes-es.ts` (delete `priceAndFit`, `plotHelp`, `plotRule` and `plotPoint`)
- Delete:
  - `src/components/quotes/PricePlot.tsx`
  - `src/lib/quote-plot.ts`
  - `src/lib/quote-plot.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `unrankedTitle`.
  - Task 3: `KitNeedTiles`.
  - Tasks 4–5: the cards.
- Produces the final page structure that Task 7 tests:
  - the `What your kit needs` region;
  - the best card region, then the "How the others compare" list (side by side at ≥ 1024 px);
  - the unranked section titled by `unrankedTitle`.

- [ ] **Step 1: Replace the body of the `return` in `VerdictView.tsx`**

1. Remove the `PricePlot` import.
2. Add these imports:
   - `import { KitNeedTiles } from './KitNeedTiles'`
   - `unrankedTitle`, added to the existing `'../../lib/quote-text'` import (next to `rejectionText`).
3. Replace everything from `return (` (the final one) to the end of the component with:

```tsx
  const ranked = others.length > 0 && (
    <section className="qlist" aria-labelledby="qlist-title">
      <h2 className="qpanel__title" id="qlist-title">{verdict.best ? t.quotes.othersTitle : t.quotes.allTitle}</h2>
      <div className="qlist__rows">
        {others.map((r) => (
          <QuoteRow key={r.quote.id} r={r} verdict={verdict} kit={kit} error={errorFor(r.quote.id)}
            onOverride={onOverride(r.quote.id)} onDelete={remove(r.quote.id)} />
        ))}
      </div>
    </section>
  )

  return (
    <div className="qv">
      {back}
      <VerdictHeader verdict={verdict} kit={kit} progress={progress} />
      {verdict.ranked.length > 0 && <KitNeedTiles kit={kit} />}
      {verdict.best ? (
        <div className="qv__grid">
          <BestCard best={verdict.best} kit={kit} error={errorFor(verdict.best.quote.id)}
            onOverride={onOverride(verdict.best.quote.id)} onDelete={remove(verdict.best.quote.id)} />
          {ranked}
        </div>
      ) : ranked}
      {verdict.unranked.length > 0 && (
        <section className="qlist" aria-labelledby="qunranked-title">
          <h2 className="qpanel__title" id="qunranked-title">{unrankedTitle(t, verdict.unranked)}</h2>
          <div className="qlist__rows">
            {verdict.unranked.map((u) => (
              <UnrankedRow key={u.quote.id} u={u} error={errorFor(u.quote.id)} retry={retryFor(u.quote.id)}
                onRetry={run(u.quote.id, () => retryQuote({ data: { quoteId: u.quote.id } }))}
                onDelete={remove(u.quote.id)}
                onTotal={(total) => void run(u.quote.id, () => setQuoteTotal({ data: { quoteId: u.quote.id, total } }))()} />
            ))}
          </div>
        </section>
      )}
      <footer className="qfoot">
        <p className="fine muted">{t.quotes.finePrint}</p>
        <div className="qfoot__actions">
          <button type="button" className="qbtn" onClick={() => setMustsOpen(true)}>{t.quotes.changeMusts}</button>
          {footerExtra}
        </div>
      </footer>
      <MustsSheet isOpen={isMustsOpen} onOpenChange={setMustsOpen} musts={musts} onChange={(i, v) => void onMust(i, v)} error={errorFor('musts')} />
    </div>
  )
```

- [ ] **Step 2: Delete the plot and its strings**

```bash
git rm src/components/quotes/PricePlot.tsx src/lib/quote-plot.ts src/lib/quote-plot.test.ts
```

Remove `priceAndFit`, `plotHelp`, `plotRule` and `plotPoint` from `quotesEn` and `quotesEs`.

- [ ] **Step 3: CSS cleanup**

In `src/styles/quotes.css`:

1. Delete every rule whose selector contains any of these classes:
   - `.qplot`;
   - `.qrank`, including `.qrank--best`;
   - `.qrow__head` (including the `@media (min-width: 1024px)` block that only holds `.qrow__head`) and `.qrow__head > .qrank`;
   - `.qrow__main`, `.qrow__strip`, `.qrow__money`, `.qrow__toggle`, `.qrow__titleline`, `.qrow__delta`.
2. Remove `.qrow__toggle` and `.qrow__toggle svg` from the `:focus-visible` list and the reduced-motion list.
3. Change `.qv__grid` in the `@media (min-width: 1024px)` block to:

```css
  .qv__grid { grid-template-columns: 400px minmax(0, 1fr); align-items: start; }
```

Then run:

```bash
rg -n "qplot|qrank|qrow__(head|main|strip|money|toggle|titleline|delta)|plotScale|PricePlot|priceAndFit|plotHelp|plotRule|plotPoint" src e2e
```

Expected: no matches, except the `e2e/quotes.spec.ts:36` plot assertion, which Task 7 replaces.

- [ ] **Step 4: Check and commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass, and coverage stays above the 80 % floor (`npm run test:coverage` if in doubt).

```bash
git add src/components/quotes/VerdictView.tsx src/styles/quotes.css src/i18n/quotes-en.ts src/i18n/quotes-es.ts
git commit -m "feat: verdict page shows the kit's needs and the quotes as cards, without the price plot"
```

The `git rm` from Step 2 is already staged; this commit includes it.

---

### Task 7: E2E, phone layout test and screenshots

**Files:**
- Modify: `e2e/quotes.spec.ts`

**Interfaces:**
- Consumes:
  - The final page from Task 6.
  - The `.qrow__total` and `.qrow__reason` classes and the `h3` names from Task 5.
  - `.qgauge__name` from Task 3.
  - `switchLanguage(page, 'Español')` from `e2e/header.ts`.
  - The existing helpers `signUp`, `uploadQuotes`, `quotePdf`, `openVerdictFromTray`, `verdictHeading`.
- Produces: green E2E on both Playwright projects, plus four PNGs: EN and ES, each from the `phone` and `desktop` projects.

- [ ] **Step 1: Update the first test**

In `test('quotes upload, are read in the background, and end in a verdict'…)`, replace the line

```ts
  await expect(page.getByRole('img', { name: /SolarTec Caribe, \$6,480, Best fit/ })).toBeVisible()
```

with:

```ts
  await expect(page.getByRole('region', { name: 'What your kit needs' })).toBeVisible()
  const best = page.getByRole('region', { name: 'SolarTec Caribe' })
  await expect(best.getByRole('img', { name: /^Inverter: .+ needed, / })).toBeVisible()
  await expect(best.getByText('solartec.pdf')).toBeVisible()
  await expect(rows.nth(0)).toContainText('$820 more than the best')
  await expect(rows.nth(1)).toContainText('$330 less than the best')
```

- [ ] **Step 2: Rename the checks-button selectors**

Replace every `'Show every check for ` with `'Show checks for `. There are 3 occurrences; `rg -n "Show every check" e2e` should then return nothing. If `'Hide the checks for ` appears, replace it with `'Hide checks for `.

- [ ] **Step 3: Add the phone layout test**

1. Add `import { switchLanguage } from './header'` to the imports.
2. Append the test:

```ts
test('on a phone, every card keeps its name, total, reason and gauge labels apart', async ({ page }, testInfo) => {
  await signUp(page)
  await uploadQuotes(page, await Promise.all(ALL.map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')

  if (testInfo.project.name === 'phone') {
    for (const card of await page.getByRole('article').all()) {
      const name = await card.getByRole('heading', { level: 3 }).boundingBox()
      const total = await card.locator('.qrow__total').boundingBox()
      const reason = await card.locator('.qrow__reason').boundingBox()
      if (!name || !total || !reason) throw new Error('a card is missing its name, total or reason')
      expect(name.x + name.width).toBeLessThanOrEqual(total.x)
      expect(reason.width).toBeGreaterThanOrEqual(200)
    }
    const zoneNames = await page.getByRole('region', { name: 'SolarTec Caribe' }).locator('.qgauge').first().locator('.qgauge__name').all()
    const boxes = await Promise.all(zoneNames.map((n) => n.boundingBox()))
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1]
      const cur = boxes[i]
      if (!prev || !cur) throw new Error('a gauge zone name is not visible')
      expect(prev.x + prev.width).toBeLessThanOrEqual(cur.x + 0.5)
    }
  }

  await page.screenshot({ path: testInfo.outputPath(`verdict-${testInfo.project.name}-en.png`), fullPage: true })
  await switchLanguage(page, 'Español')
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe cumple con tu kit por menos')
  await page.screenshot({ path: testInfo.outputPath(`verdict-${testInfo.project.name}-es.png`), fullPage: true })
})
```

3. A `.qgauge__name` span sits inside a grid cell, so its box is the text's width. When names collide, the box of the earlier name extends past the start of the next one, and the test fails.

- [ ] **Step 4: Run the quotes E2E**

Run: `CI=true E2E_PORT=3137 npx playwright test e2e/quotes.spec.ts`

Expected: all tests pass on `desktop` and `phone`.

- **If the layout test fails on overlap:** fix the CSS, not the test. Typical fixes:
  - `min-width: 0` on a flex child;
  - `white-space: nowrap` on the total;
  - the `qgauge__names` font size.
- **If a server fails to start with "already used":** another run holds port 3137. Pick another `E2E_PORT`.

- [ ] **Step 5: Collect the screenshots**

```bash
fd 'verdict-.*\.png' test-results
```

Copy the phone EN/ES and desktop EN files to the scratchpad directory given in the prompt. `test-results/` is gitignored; don't commit images.

- [ ] **Step 6: Run the full gate and commit**

```bash
npm run typecheck && npm test && npm run build
git add e2e/quotes.spec.ts
git commit -m "test: e2e for the sizing gauge, card text and the phone layout of the verdict page"
```

---

## After the last task

The whole-branch reviewer reads `git diff 2185cea..HEAD` against this plan and the spec. It checks four things:

- **The Global Constraints:**
  - no sentence built in a component;
  - EN/ES parity;
  - amber, not red;
  - 44 px targets;
  - reduced motion.
- **Each Review Focus line** has its test.
- **No leftovers** from the plot or the old row grid.
- **Commits** carry no attribution lines.

Then the orchestrator:
1. runs the full gate once more;
2. sends the user the phone screenshots;
3. does not push.
