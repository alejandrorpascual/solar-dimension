# Quotes that offer several systems ("options"): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A quote that offers alternative systems (the SUNA M.P. quote) is read as options, each option is ranked as its own entry with its own price, and quotes read before this change can be read again.

**Architecture:** The model marks options and line membership (`options`, `line.option`); everything else is pure code in `src/lib`. A new `quote-options.ts` slices an extraction per option; `optionPrices` (in `quote-checks.ts`) prices each option; `compareQuotes` expands a ready quote with options into one entry per option. The cards keep variant A's layout; only the subtitle, keys and delete confirmation change. Retry is widened to `needs_review` and shown as "Read again".

**Tech Stack:** TypeScript, zod, React 19 + TanStack Start, Drizzle (Postgres jsonb), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-quote-options-design.md`

## Global Constraints

- The AI reads; code decides. The model only says which lines belong to which option and an option's price when written. Grouping, prices, fit and ranking are computed in `src/lib`.
- Never infer: the prompt still forbids estimating. Splitting a bundled line copies what is written.
- One system per quote works exactly as today: same entries, same totals, same checks.
- EN and ES ship together (`src/i18n/quotes-en.ts`, `src/i18n/quotes-es.ts`; `QuoteKey = keyof typeof quotesEn`, so a missing ES key is a type error).
- Immutable helpers only: return new objects, never mutate.
- Sentence case in every string.
- Plus the Global Constraints of `docs/superpowers/plans/2026-09-29-quote-verdict-b.md`.
- Nothing is migrated: stored extractions are read through `withOptionDefaults`.
- `readCount`, `failedCount` and the tray count quotes (files), not entries.

## Decisions this plan makes where the spec is silent

- **`hasOptions(x)` means 2 or more options.** `normalizeExtraction` keeps `options` either empty or with 2–5 entries: fewer than two becomes `[]` with every `line.option` null, so "one option" can't half-split a quote.
- **Option ids are cut to 12 characters and de-duplicated** (first wins), so `entryKey` is unique per card.
- **Lines of options cut by the cap of 5 are dropped**, not nulled: nulling would make a sixth system's inverter "shared" and add it to every other option. Lines naming an id that was never listed are nulled, as the spec says.
- **An option with no priced line of its own has no price**, even when shared lines cost something: installation alone doesn't price a system. It becomes `no_price`.
- **`optionPrices` lives in `quote-checks.ts`** (as the spec says); the slicing helpers live in a new `quote-options.ts`, so `quote-checks` and `quote-compare` both import them without a cycle.
- **A quote with options is expanded only when `ready`.** A `needs_review` quote with options stays one unranked card. It shows a help line instead of the total form, because a typed total wouldn't belong to either kit, and it offers "Read again".
- **Headings use the option's name.** `verdictHeading`, `verdictSubline` (closest), `askText`, `projectLine` and the hidden name of the checks toggle use `entryName(e)` ("SUNA M.P. · Inversor 10 kW"). `questionText` keeps the vendor name, because it greets the installer ("Hi SUNA M.P., …"). `entryName` takes no dictionary: the separator isn't localized.
- **`MAX_OUTPUT_TOKENS` becomes 12,500, not ~12,300.** The spec counted the `options` list (~300 tokens) but not the new `"option":…` key on each of the 80 lines (~5 tokens each, ~400).
- **The ES delete confirmation says "Eliminar"**, matching the existing `deleteConfirm`, not the spec's "Borrar".
- **Bundled lines get `unitPrice: null` too**, so a copied unit price can't trip `line_mismatch` on a split line priced 0.
- **The `extraction` column is typed `StoredExtraction`** (type only, no migration), so TypeScript forces every read through `withOptionDefaults`.

## Review Focus

1. **The model lists one option, or the same id twice.** One option should read as a single-system quote, and two options sharing an id must not give two cards with the same React key. This is pinned in Task 1's `normalizeExtraction` tests.
2. **An option whose lines carry no price but whose shared lines do** (installation 500, the 10 kW kit's line at 0) must be `no_price`, not ranked at 500. This is pinned in Task 2's `optionPrices` test.
3. **A Read again on a `needs_review` quote that fails on both models** leaves it `failed`, with Retry while retries remain. The earlier reading isn't shown again. That's today's failed path. Task 5's `retryOffer` test pins that a `needs_review` quote with its retries used up offers no button, and that the "after several tries" note shows only for a failed quote.
4. **A `needs_review` quote with options** must never show the total form; it shows the help line and Read again. This is pinned in Task 4's `compareQuotes` test (one unranked entry, `no_total`, `optionCount` 2) and in Task 6's `UnrankedRow` branch.
5. **Saving an override fails on one option's card.** The error must show on that card only, not on its sibling: errors are keyed by `entryKey`, while the save goes to the quote id. This is pinned in Task 6's `VerdictView` change (`onOverride(quoteId, key)`) and checked in its manual step.

---

## File map

| File | Change |
|---|---|
| `src/lib/quote-schema.ts` | `options`, `line.option`, `normalizeExtraction` rules, `StoredExtraction`, `withOptionDefaults` |
| `src/lib/quote-options.ts` (new) | `hasOptions`, `optionLines`, `optionExtraction` |
| `src/lib/quote-checks.ts` | `optionPrices`; `no_total` / `total_mismatch` with options |
| `src/lib/quote-fixtures.ts` | `option: null` / `options: []` defaults; `SAMPLE_QUOTES.suna` |
| `src/server/quotes/model.ts` | prompt rules, `MAX_OUTPUT_TOKENS` |
| `src/db/schema.ts` | `extraction` typed `StoredExtraction` |
| `src/server/quotes/api.ts` | `toJobQuote` runs `withOptionDefaults` |
| `src/lib/quote-compare.ts` | entries per option, `no_price`, `entryKey`, `entryName` |
| `src/lib/quote-text.ts` | `entrySubtitle`, `deleteConfirmText`, `isBest` by key, `entryName` in headings and project line |
| `src/lib/quote-jobs.ts` | `best.optionLabel` |
| `src/lib/quote-guards.ts` | `RETRYABLE` gains `needs_review` |
| `src/i18n/quotes-en.ts`, `quotes-es.ts` | `optionOf`, `noPrice`, `deleteConfirmOptions`, `readAgain`, `optionsReviewHelp` |
| `src/components/quotes/{VerdictView,QuoteRow,BestCard,UnrankedRow,QuoteActions}.tsx` | keys, subtitles, Read again, confirmation |
| `e2e/db.ts`, `e2e/quotes.spec.ts` | two E2E tests |

Test commands: `npx vitest run <file>` for one file, `npm test` for all unit tests, `npm run typecheck` (check `package.json`; if the script is named otherwise, use `npx tsc --noEmit`), `npx playwright test e2e/quotes.spec.ts -g "<name>"` for E2E (needs `.env.test.local`; see the e2e-test-database memory).

---

### Task 1: Schema fields, normalization and stored defaults

**Files:**
- Modify: `src/lib/quote-schema.ts`
- Modify: `src/lib/quote-fixtures.ts` (defaults only)
- Modify: `src/db/schema.ts:79`
- Modify: `src/server/quotes/api.ts` (`toJobQuote`)
- Test: `src/lib/quote-schema.test.ts`

**Interfaces:**
- Produces: `QuoteExtraction['options']: { id: string; label: string; total: number | null }[]`; `QuoteLine['option']: string | null`; `type QuoteOption = QuoteExtraction['options'][number]`; `type StoredExtraction`; `withOptionDefaults(x: StoredExtraction): QuoteExtraction`; `MAX_OPTIONS = 5`.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/quote-schema.test.ts`; add `MAX_OPTIONS, withOptionDefaults` to the import from `./quote-schema`)

```ts
const opt = (id: string, label = id) => ({ id, label, total: null })

describe('normalizeExtraction with options', () => {
  test('caps options at 5, cuts labels to 60 characters and drops the lines of options past the cap', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const x = extraction(ids.map((id) => line('inverter', 100, { option: id })), {
      options: ids.map((id) => opt(id, 'x'.repeat(80))),
    })
    const n = normalizeExtraction(x)
    expect(n.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(MAX_OPTIONS).toBe(5)
    expect(n.options[0]!.label).toHaveLength(60)
    expect(n.lines.map((l) => l.option)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  test('nulls a line whose option was never listed', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('labor', 50, { option: 'zz' })], { options: [opt('a'), opt('b')] })
    expect(normalizeExtraction(x).lines.map((l) => l.option)).toEqual(['a', null])
  })
  test('one option is one system: no options, and every line shared', () => {
    const x = extraction([line('inverter', 100, { option: 'a' })], { options: [opt('a')] })
    const n = normalizeExtraction(x)
    expect(n.options).toEqual([])
    expect(n.lines[0]!.option).toBeNull()
  })
  test('a repeated option id keeps the first, so no two cards share a key', () => {
    const x = extraction([line('inverter', 100, { option: 'a' })], { options: [opt('a', 'First'), opt('a', 'Again'), opt('b')] })
    expect(normalizeExtraction(x).options.map((o) => o.label)).toEqual(['First', 'b'])
  })
  test('cuts ids to 12 characters, on the options and on the lines alike', () => {
    const long = 'option-number-one'
    const x = extraction([line('inverter', 100, { option: long })], { options: [opt(long), opt('b')] })
    const n = normalizeExtraction(x)
    expect(n.options[0]!.id).toBe('option-numbe')
    expect(n.lines[0]!.option).toBe('option-numbe')
  })
})

describe('withOptionDefaults', () => {
  test('a reading stored before options gets none, and every line is shared', () => {
    const { options: _o, ...old } = extraction([line('inverter', 100)])
    const stored = { ...old, lines: old.lines.map(({ option: _l, ...l }) => l) }
    const x = withOptionDefaults(stored)
    expect(x.options).toEqual([])
    expect(x.lines[0]!.option).toBeNull()
  })
  test('a reading with options is kept as it is', () => {
    const x = extraction([line('inverter', 100, { option: 'a' })], { options: [opt('a'), opt('b')] })
    expect(withOptionDefaults(x)).toEqual(x)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quote-schema.test.ts`
Expected: FAIL, with type and runtime errors about `options` / `option` / `withOptionDefaults` not existing.

- [ ] **Step 3: Add the fields to the schema** (`src/lib/quote-schema.ts`)

Put `options` before `lines` (the model decides the grouping before writing lines), and `option` after `optional`:

```ts
  currency: z.string(),
  /** Alternative systems the document offers, each priced on its own. Empty for a quote that offers one system. */
  options: z.array(z.object({ id: z.string(), label: z.string(), total: z.number().nullable() })),
  lines: z.array(
    z.object({
      // …unchanged fields…
      optional: z.boolean(),
      /** The id of the option the line belongs to; null when it applies to every option, or the quote offers one system. */
      option: z.string().nullable(),
```

After the `LineSpecs` type:

```ts
export type QuoteOption = QuoteExtraction['options'][number]

/** A reading as stored: one saved before options has neither field (jsonb is read as is). */
export type StoredExtraction = Omit<QuoteExtraction, 'options' | 'lines'> & {
  options?: QuoteOption[]
  lines: (Omit<QuoteLine, 'option'> & { option?: string | null })[]
}

/** A stored reading with the option fields filled: a reading from before options offers one system. Returns a new object. */
export function withOptionDefaults(x: StoredExtraction): QuoteExtraction {
  return { ...x, options: x.options ?? [], lines: x.lines.map((l) => ({ ...l, option: l.option ?? null })) }
}
```

- [ ] **Step 4: Normalize options** (`src/lib/quote-schema.ts`)

Add `optionLabel: 60` to `TEXT` and export the cap:

```ts
const TEXT = { short: 120, code: 12, date: 10, description: 300, source: 160, note: 300, optionLabel: 60 } as const
const LIST = { lines: 80, warranties: 10, notes: 20 } as const
/** The most options one quote keeps; a sixth system and its lines are dropped. */
export const MAX_OPTIONS = 5
```

Above `normalizeExtraction`:

```ts
/**
 * The options kept and the ids dropped by the cap. Ids are cut like codes and a repeated id keeps the first. Fewer than
 * two options is one system, so none are kept and none dropped: every line becomes shared.
 */
function splitOptions(options: readonly QuoteOption[]): { kept: QuoteOption[]; dropped: Set<string> } {
  const cutOptions = options.map((o) => ({ ...o, id: cut(o.id, TEXT.code), label: cut(o.label.trim(), TEXT.optionLabel) }))
  const unique = cutOptions.filter((o, i) => cutOptions.findIndex((p) => p.id === o.id) === i)
  const kept = unique.slice(0, MAX_OPTIONS)
  if (kept.length < 2) return { kept: [], dropped: new Set() }
  return { kept, dropped: new Set(unique.slice(MAX_OPTIONS).map((o) => o.id)) }
}

/** A line's option after the split: kept, null (shared, or an id never listed), or undefined when its option was dropped. */
function lineOption(option: string | null, kept: ReadonlySet<string>, dropped: ReadonlySet<string>): string | null | undefined {
  if (option === null) return null
  const id = cut(option, TEXT.code)
  if (kept.has(id)) return id
  return dropped.has(id) ? undefined : null
}
```

Change `normalizeExtraction` (update its doc comment to "Trims every text to its limit, caps the lists, splits the options and upper-cases the currency. Returns a new object."):

```ts
export function normalizeExtraction(x: QuoteExtraction): QuoteExtraction {
  const { kept, dropped } = splitOptions(x.options)
  const keptIds = new Set(kept.map((o) => o.id))
  return {
    ...x,
    vendor: { name: cutOrNull(x.vendor.name, TEXT.short), contact: cutOrNull(x.vendor.contact, TEXT.short) },
    date: cutOrNull(x.date, TEXT.date),
    validUntil: cutOrNull(x.validUntil, TEXT.date),
    currency: x.currency.trim().toUpperCase(),
    options: kept,
    lines: x.lines.slice(0, LIST.lines).flatMap((l) => {
      const option = lineOption(l.option, keptIds, dropped)
      if (option === undefined) return []
      return [{
        ...l,
        option,
        description: cut(l.description, TEXT.description),
        brand: cutOrNull(l.brand, TEXT.short),
        model: cutOrNull(l.model, TEXT.short),
        specs: { ...l.specs, awg: cutOrNull(l.specs.awg, TEXT.code), fuseClass: cutOrNull(l.specs.fuseClass, TEXT.code) },
        source: { page: l.source.page, text: cut(l.source.text, TEXT.source) },
      }]
    }),
    warranties: x.warranties.slice(0, LIST.warranties),
    notes: x.notes.slice(0, LIST.notes).map((n) => cut(n, TEXT.note)),
  }
}
```

- [ ] **Step 5: Give the fixture helpers the new defaults** (`src/lib/quote-fixtures.ts`)

In `line()`, add `option: null` after `optional: false`. In `extraction()`, add `options: []` after `currency: 'USD'`.

- [ ] **Step 6: Read stored rows through the defaults**

`src/db/schema.ts:79`: `extraction: jsonb('extraction').$type<StoredExtraction>(),` (import `StoredExtraction` instead of / next to `QuoteExtraction`; drop `QuoteExtraction` from the import if nothing else uses it).

`src/server/quotes/api.ts`, in `toJobQuote`: `extraction: r.extraction ? withOptionDefaults(r.extraction) : null,` and add `import { withOptionDefaults } from '../../lib/quote-schema'` (merge with the existing `FINISHED` import).

The worker writes a full `QuoteExtraction`, which is assignable to `StoredExtraction`, so `repo.ts` needs no change.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run src/lib/quote-schema.test.ts && npm run typecheck`
Expected: PASS, no type errors. If any other file builds a `QuoteExtraction` or `QuoteLine` literal without the helpers, the typecheck names it: add `options: []` / `option: null` there.

- [ ] **Step 8: Run all unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/quote-schema.ts src/lib/quote-schema.test.ts src/lib/quote-fixtures.ts src/db/schema.ts src/server/quotes/api.ts
git commit -m "feat: options a quote offers, and the option of each line, in the extraction"
```

---

### Task 2: Option helpers, option prices, checks and the SUNA fixture

**Files:**
- Create: `src/lib/quote-options.ts`
- Modify: `src/lib/quote-checks.ts`
- Modify: `src/lib/quote-fixtures.ts` (`SAMPLE_QUOTES.suna`)
- Test: `src/lib/quote-options.test.ts` (new), `src/lib/quote-checks.test.ts`

**Interfaces:**
- Consumes: Task 1's `options`, `line.option`, `QuoteOption`.
- Produces: `hasOptions(x: QuoteExtraction): boolean`; `optionLines(x, id: string): QuoteLine[]`; `optionExtraction(x, id: string): QuoteExtraction`; `optionPrices(x: QuoteExtraction): { id: string; total: number | null }[]`; `SAMPLE_QUOTES.suna` with options `o1` ("Inversor 3 kW", USD 2,600) and `o2` ("Inversor 10 kW", USD 6,200).

- [ ] **Step 1: Write the failing tests**

`src/lib/quote-options.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_QUOTES } from './quote-fixtures'
import { hasOptions, optionExtraction, optionLines } from './quote-options'

describe('options of a quote', () => {
  const x = extraction(
    [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' }), line('labor', 50)],
    { options: [{ id: 'a', label: 'A', total: null }, { id: 'b', label: 'B', total: null }] },
  )
  test('a quote offers options when it lists two or more', () => {
    expect(hasOptions(x)).toBe(true)
    expect(hasOptions(SAMPLE_QUOTES.solartec)).toBe(false)
  })
  test("an option's lines are its own and the shared ones", () => {
    expect(optionLines(x, 'a').map((l) => l.lineTotal)).toEqual([100, 50])
    expect(optionLines(x, 'b').map((l) => l.lineTotal)).toEqual([200, 50])
  })
  test('the quote as if it offered one option keeps everything else', () => {
    const a = optionExtraction(x, 'a')
    expect(a.lines).toHaveLength(2)
    expect(a.currency).toBe(x.currency)
    expect(x.lines).toHaveLength(3)
  })
})
```

Append to `src/lib/quote-checks.test.ts` (import `optionPrices` from `./quote-checks`):

```ts
describe('optionPrices', () => {
  const opts = (a: number | null = null, b: number | null = null) => [{ id: 'a', label: 'A', total: a }, { id: 'b', label: 'B', total: b }]
  test('a written total wins over the lines', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' })], { options: opts(999) })
    expect(optionPrices(x)).toEqual([{ id: 'a', total: 999 }, { id: 'b', total: 200 }])
  })
  test('with prices only on lines, each option is its own lines plus the shared ones', () => {
    const x = extraction(
      [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' }), line('labor', 50), line('wiring', 30, { optional: true })],
      { options: opts() },
    )
    expect(optionPrices(x)).toEqual([{ id: 'a', total: 150 }, { id: 'b', total: 250 }])
  })
  test('an option whose own lines carry no price has none, even when shared lines do', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('inverter', 0, { option: 'b' }), line('labor', 500)], { options: opts() })
    expect(optionPrices(x)).toEqual([{ id: 'a', total: 600 }, { id: 'b', total: null }])
  })
  test('the SUNA quote prices its two kits', () => {
    expect(optionPrices(SAMPLE_QUOTES.suna)).toEqual([{ id: 'o1', total: 2600 }, { id: 'o2', total: 6200 }])
  })
})

describe('checkExtraction with options', () => {
  test('the SUNA quote passes: it states no total, but each option has a price', () => {
    expect(checkExtraction(SAMPLE_QUOTES.suna)).toEqual([])
  })
  test('no_total only when no option has a price', () => {
    const x = extraction([line('inverter', 0, { option: 'a' }), line('inverter', 0, { option: 'b' })], {
      total: 0, options: [{ id: 'a', label: 'A', total: null }, { id: 'b', label: 'B', total: null }],
    })
    expect(checkExtraction(x)).toContain('no_total')
  })
  test('options are never added up against a total, but each line still is checked', () => {
    const options = [{ id: 'a', label: 'A', total: null }, { id: 'b', label: 'B', total: null }]
    const lines = [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' })]
    expect(checkExtraction(extraction(lines, { options, subtotal: 300, tax: 0, total: 999 }))).toEqual([])
    const wrongLine = [line('inverter', 100, { option: 'a', qty: 2, unitPrice: 100 }), line('inverter', 200, { option: 'b' })]
    expect(checkExtraction(extraction(wrongLine, { options }))).toContain('line_mismatch')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/quote-options.test.ts src/lib/quote-checks.test.ts`
Expected: FAIL: `./quote-options` not found, `optionPrices` not exported, `SAMPLE_QUOTES.suna` undefined.

- [ ] **Step 3: Write `src/lib/quote-options.ts`**

```ts
import type { QuoteExtraction, QuoteLine } from './quote-schema'

/** Whether a quote offers several systems to choose from. normalizeExtraction keeps either none or two to five. */
export const hasOptions = (x: QuoteExtraction): boolean => x.options.length >= 2

/** An option's lines: its own, and the ones every option shares (option null). */
export const optionLines = (x: QuoteExtraction, id: string): QuoteLine[] => x.lines.filter((l) => l.option === id || l.option === null)

/** The quote as if it offered only this option, for the per-item checks. Returns a new object. */
export const optionExtraction = (x: QuoteExtraction, id: string): QuoteExtraction => ({ ...x, lines: optionLines(x, id) })
```

- [ ] **Step 4: Price options and adapt the checks** (`src/lib/quote-checks.ts`)

```ts
import { hasOptions } from './quote-options'
import type { QuoteExtraction, QuoteLine } from './quote-schema'
```

After `hasTotal`:

```ts
const includedSum = (lines: readonly QuoteLine[]): number => lines.filter((l) => !l.optional).reduce((a, l) => a + l.lineTotal, 0)

/**
 * Each option's price: the total the document writes for it, else its own included lines plus the shared ones. An
 * option whose own lines carry no price has none: shared lines alone (installation, transport) don't price a system.
 */
export function optionPrices(x: QuoteExtraction): { id: string; total: number | null }[] {
  const shared = includedSum(x.lines.filter((l) => l.option === null))
  return x.options.map((o) => {
    if (hasTotal(o.total)) return { id: o.id, total: o.total }
    const own = includedSum(x.lines.filter((l) => l.option === o.id))
    return { id: o.id, total: own > 0 ? own + shared : null }
  })
}
```

In `checkExtraction`, replace the `no_total` line and guard the total check:

```ts
  const isMulti = hasOptions(x)
  // The schema needs a number, so a quote that states no total comes back as 0: it waits for the user's total. A quote
  // offering several systems has no total of its own; it needs a price for at least one of them.
  const isPriced = isMulti ? optionPrices(x).some((p) => p.total !== null) : hasTotal(x.total)
  if (!isPriced) failures.push('no_total')
```

```ts
  // Alternatives don't add up to anything, so a quote with options skips the total check; each line is still checked.
  if (!isMulti && (x.subtotal !== null || x.tax !== null)) {
    const sum = includedSum(x.lines) + (x.tax ?? 0)
    if (!near(sum, x.total, TOTAL_TOLERANCE)) failures.push('total_mismatch')
  }
```

- [ ] **Step 5: Add the SUNA fixture** (`src/lib/quote-fixtures.ts`, inside `SAMPLE_QUOTES`, after `enerhogar`)

```ts
  /**
   * The user's SUNA M.P. quote: two alternative kits, each priced on its own, and a blank total. Each kit's batteries
   * and controller are written into the inverter's line, so they are split into their own lines at 0.
   */
  suna: extraction(
    [
      ...[
        line('inverter', 2600, { option: 'o1', specs: { watts: 3000 } }),
        line('battery', 0, { option: 'o1', qty: 2, specs: { kWh: 5.12, chemistry: 'lifepo4' } }),
      ].map((l) => ({ ...l, ...said(1, 'Inversor de corriente 3 kW, incluye 2 baterías de litio 5.12 kWh, transfer y flete') })),
      ...[
        line('inverter', 6200, { option: 'o2', specs: { watts: 10000 } }),
        line('battery', 0, { option: 'o2', specs: { ah: 200, chemistry: 'lifepo4' } }),
        line('charge_controller', 0, { option: 'o2', specs: { chargerAmps: 80 } }),
      ].map((l) => ({ ...l, ...said(1, 'Inversor de corriente 10 kW, incluye baterías de litio 200 Ah, controlador solar 80 A/48 V') })),
    ],
    {
      vendor: { name: 'SUNA M.P.', contact: null }, total: 0,
      options: [{ id: 'o1', label: 'Inversor 3 kW', total: null }, { id: 'o2', label: 'Inversor 10 kW', total: null }],
    },
  ),
```

The stub model (`src/server/quotes/stub-model.ts`) picks fixtures by key, so `suna.pdf` now reads as this quote with no further change.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/quote-options.test.ts src/lib/quote-checks.test.ts src/lib/quote-schema.test.ts`
Expected: PASS, including the existing "passes every sample quote" and "accepts every sample quote", which now cover SUNA.

- [ ] **Step 7: Run all unit tests, then commit**

Run: `npm test` (expected PASS; a test iterating `Object.values(SAMPLE_QUOTES)` with a single-system assumption would show here, so fix it by naming the quotes it means.)

```bash
git add src/lib/quote-options.ts src/lib/quote-options.test.ts src/lib/quote-checks.ts src/lib/quote-checks.test.ts src/lib/quote-fixtures.ts
git commit -m "feat: price each option a quote offers, and check a quote with options without a total"
```

---

### Task 3: Prompt rules and the output cap

**Files:**
- Modify: `src/server/quotes/model.ts`
- Test: `src/server/quotes/model.test.ts`

**Interfaces:**
- Consumes: Task 1's schema (the request's `text.format` comes from `QuoteExtractionSchema`, so it already carries the fields).
- Produces: `SYSTEM_PROMPT` with the two rules; `MAX_OUTPUT_TOKENS = 12_500`.

- [ ] **Step 1: Write the failing tests** (in `src/server/quotes/model.test.ts`)

Change the existing expectation `expect(MAX_OUTPUT_TOKENS).toBe(12_000)` to `12_500`, and add:

```ts
  test('the prompt asks for the options a quote offers, and one line per bundled component', () => {
    expect(SYSTEM_PROMPT).toContain('alternative systems or packages to choose from')
    expect(SYSTEM_PROMPT).toContain("set each line's option to the id")
    expect(SYSTEM_PROMPT).toContain('options is empty and every option is null')
    expect(SYSTEM_PROMPT).toContain('write one line per component')
  })
  test('the structured output asks for options and each line\'s option', () => {
    const schema = JSON.stringify(extractRequest({ bytes: new Uint8Array([1]), mime: 'application/pdf', fileName: 'q.pdf' }, 'm').text.format)
    expect(schema).toContain('"options"')
    expect(schema).toContain('"option"')
  })
```

(If the file already has a `req` built from `extractRequest`, use it instead of building another.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/server/quotes/model.test.ts`
Expected: FAIL on the token cap and the prompt text. The schema test may already pass after Task 1; that's fine.

- [ ] **Step 3: Update the cap and its arithmetic**

```ts
/**
 * The most the model may write for one quote, which bounds what a read can cost. Sized for the largest extraction the
 * app keeps (normalizeExtraction): a line of the sample quotes is ~440 characters of compact JSON with its option, ~125
 * tokens at ~3.5 characters per token for key-heavy JSON, so 80 lines are ~10,000; 20 notes of up to 300 characters
 * ~1,700; 5 options ~300; vendor, dates, totals and 10 warranties ~300. That is ~12,300, rounded up. Reasoning tokens
 * count against it too, so a reasoning model needs more. An answer cut short fails the parse and is refused
 * (readExtraction).
 */
export const MAX_OUTPUT_TOKENS = 12_500
```

- [ ] **Step 4: Add the prompt rules** right after the `'Set optional to true …'` line in `SYSTEM_PROMPT`:

```ts
  'When the document offers alternative systems or packages to choose from, each priced on its own (for example "Option 1" and "Option 2", or two complete kits, each with its own inverter, listed one after another with no total that adds them up), list each in options with a short label in the document\'s language, and set each line\'s option to the id of the option it belongs to.',
  'Set option to null for lines that apply to every alternative, such as shared installation or transport. Set an option\'s total only when the document writes it.',
  'When the document offers one system, options is empty and every option is null.',
  'When one line describes several components, such as an inverter that includes batteries or a solar charge controller, write one line per component, each with its own kind and specs, the same source and the same option. The first gets the written price; the others get lineTotal 0 and unitPrice null.',
```

- [ ] **Step 5: Run the tests and commit**

Run: `npx vitest run src/server/quotes/model.test.ts src/server/quotes/process.test.ts`
Expected: PASS.

```bash
git add src/server/quotes/model.ts src/server/quotes/model.test.ts
git commit -m "feat: ask the model for the options a quote offers, and one line per bundled component"
```

---

### Task 4: Rank each option as its own entry

**Files:**
- Modify: `src/lib/quote-compare.ts`
- Test: `src/lib/quote-compare.test.ts`

**Interfaces:**
- Consumes: `hasOptions`, `optionExtraction` (quote-options), `optionPrices`, `hasTotal` (quote-checks), `SAMPLE_QUOTES.suna`.
- Produces:
  - `RankedQuote` and `UnrankedQuote` gain `optionId: string | null; optionLabel: string | null; optionCount: number` (0 for a single-system quote).
  - `UnrankedReason` gains `'no_price'`.
  - `entryKey(e: { quote: { id: string }; optionId: string | null }): string`
  - `entryName(e: { name: string; optionLabel: string | null }): string`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/quote-compare.test.ts`; add `entryKey, entryName` to the import)

```ts
describe('a quote that offers two systems', () => {
  const suna = view('suna', { createdAt: 9 })
  const v = compareQuotes(KIT, DEFAULT_MUSTS, [suna])
  const keys = (es: { quote: QuoteView; optionId: string | null }[]) => es.map(entryKey)

  test('ranks one entry per option, priced on its own', () => {
    expect(keys(v.ranked).sort()).toEqual(['suna:o1', 'suna:o2'])
    const byKey = Object.fromEntries(v.ranked.map((r) => [entryKey(r), r]))
    expect(byKey['suna:o1']).toMatchObject({ total: 2600, optionLabel: 'Inversor 3 kW', optionCount: 2, name: 'SUNA M.P.' })
    expect(byKey['suna:o2']).toMatchObject({ total: 6200, optionLabel: 'Inversor 10 kW', optionCount: 2 })
  })
  test('only the 10 kW option can fit the kit: the 3 kW one is short of the inverter', () => {
    const byKey = Object.fromEntries(v.ranked.map((r) => [entryKey(r), r]))
    expect(byKey['suna:o1']!.fit).toBe('short')
    expect(byKey['suna:o1']!.failedMusts).toContain('inverter')
    expect(byKey['suna:o2']!.fit).toBe('unclear')
    expect(byKey['suna:o2']!.failedMusts).toEqual([])
  })
  test("each option is checked on its own lines: the 3 kW kit's batteries don't reach the 10 kW one", () => {
    const o2 = v.ranked.find((r) => r.optionId === 'o2')!
    expect(o2.items.find((c) => c.id === 'battery')!.status).toBe('unknown')
  })
  test('counts the file once', () => {
    expect(v.readCount).toBe(1)
    expect(v.currency).toBe('USD')
  })
  test('an override on the quote reaches both options', () => {
    const confirmed = compareQuotes(KIT, DEFAULT_MUSTS, [{ ...suna, overrides: { installation: 'included' } }])
    for (const r of confirmed.ranked) expect(r.items.find((c) => c.id === 'installation')!.status).toBe('ok')
  })
  test('an option with no price is unranked as no_price; the other still ranks', () => {
    const x = { ...SAMPLE_QUOTES.suna, lines: SAMPLE_QUOTES.suna.lines.map((l) => (l.option === 'o1' ? { ...l, lineTotal: 0 } : l)) }
    const u = compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { extraction: x })])
    expect(u.unranked.map((e) => [entryKey(e), e.reason])).toEqual([['suna:o1', 'no_price']])
    expect(keys(u.ranked)).toEqual(['suna:o2'])
  })
  test("a quote's typed total never prices an option", () => {
    const x = { ...SAMPLE_QUOTES.suna, lines: SAMPLE_QUOTES.suna.lines.map((l) => (l.option === 'o1' ? { ...l, lineTotal: 0 } : l)) }
    const u = compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { extraction: x, totalOverride: 9000 })])
    expect(u.unranked.map((e) => e.reason)).toEqual(['no_price'])
  })
  test('a quote with options whose numbers need checking stays one card, waiting, with its option count', () => {
    const u = compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { status: 'needs_review' })])
    expect(u.ranked).toEqual([])
    expect(u.unranked).toHaveLength(1)
    expect(u.unranked[0]).toMatchObject({ reason: 'no_total', optionId: null, optionCount: 2 })
  })
  test('ranks options alongside other quotes: the 10 kW option is cheaper than SolarTec but unclear, so worth asking', () => {
    const both = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { createdAt: 0 }), suna])
    expect(both.best?.quote.id).toBe('solartec')
    expect(keys(both.worthAsking)).toEqual(['suna:o2'])
  })
})

describe('entryKey and entryName', () => {
  test('a single-system quote is its id and its name', () => {
    expect(entryKey({ quote: { id: 'q1' }, optionId: null })).toBe('q1')
    expect(entryName({ name: 'SolarTec Caribe', optionLabel: null })).toBe('SolarTec Caribe')
  })
  test('an option adds its id to the key and its label to the name', () => {
    expect(entryKey({ quote: { id: 'q1' }, optionId: 'o2' })).toBe('q1:o2')
    expect(entryName({ name: 'SUNA M.P.', optionLabel: 'Inversor 10 kW' })).toBe('SUNA M.P. · Inversor 10 kW')
  })
  test('single-system entries carry no option', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, ALL)
    for (const r of v.ranked) expect(r).toMatchObject({ optionId: null, optionLabel: null, optionCount: 0 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/quote-compare.test.ts`
Expected: FAIL: `entryKey` / `entryName` aren't exported, and SUNA ranks as one entry.

- [ ] **Step 3: Implement entries** (`src/lib/quote-compare.ts`)

Imports:

```ts
import { hasTotal, optionPrices } from './quote-checks'
import { checkItems, ITEM_IDS, type ItemCheck, type ItemId, type KitNeeds, type Musts, type Overrides } from './quote-items'
import { hasOptions, optionExtraction } from './quote-options'
import { isPending, type QuoteExtraction, type QuoteStatus } from './quote-schema'
```

Types: add to both `RankedQuote` and `UnrankedQuote`, through a shared interface:

```ts
/** Which of a quote's systems an entry is. A single-system quote has no option and an option count of 0. */
export interface EntryOption { optionId: string | null; optionLabel: string | null; optionCount: number }
export interface RankedQuote extends EntryOption {
  // …fields unchanged…
}
/**
 * needs_review: the amounts don't add up; no_total: the quote was read but states no total. Both wait for the user's
 * total. no_price: an option of a quote that offers several states no price for it.
 */
export type UnrankedReason = 'reading' | 'needs_review' | 'no_total' | 'no_price' | 'failed' | 'other_currency'
export interface UnrankedQuote extends EntryOption { quote: QuoteView; name: string; reason: UnrankedReason; currency: string | null }
```

After `quoteSubtitle`:

```ts
/** What tells entries apart: the quote, and the option for a quote that offers several. */
export const entryKey = (e: { quote: { id: string }; optionId: string | null }): string =>
  e.optionId === null ? e.quote.id : `${e.quote.id}:${e.optionId}`

/** The vendor, and the option when the quote offers several: "SUNA M.P. · Inversor 10 kW". */
export const entryName = (e: { name: string; optionLabel: string | null }): string =>
  e.optionLabel ? `${e.name} · ${e.optionLabel}` : e.name

/** One thing to rank: a whole quote, or one of the systems a quote offers, with the lines and price of that system. */
interface Entry extends EntryOption { quote: QuoteView; extraction: QuoteExtraction | null; total: number | null }

/**
 * A ready quote that offers several systems is one entry per option, priced from the document alone: the user's typed
 * total belongs to a single-system quote. Any other quote is one entry. One with options whose numbers need checking
 * has no price, so it waits as one card.
 */
function entriesOf(q: QuoteView): Entry[] {
  const x = q.extraction
  const optionCount = x !== null && hasOptions(x) ? x.options.length : 0
  if (x === null || optionCount === 0 || q.status !== 'ready') {
    return [{ quote: q, extraction: x, total: optionCount === 0 ? totalOf(q) : null, optionId: null, optionLabel: null, optionCount }]
  }
  const prices = optionPrices(x)
  return x.options.map((o, i) => ({
    quote: q, extraction: optionExtraction(x, o.id), total: prices[i]!.total, optionId: o.id, optionLabel: o.label, optionCount,
  }))
}

const optionOf = (e: Entry): EntryOption => ({ optionId: e.optionId, optionLabel: e.optionLabel, optionCount: e.optionCount })
```

Replace `isRankable`, `mainCurrency`, `unrankedReason`, `score` and the top of `compareQuotes` to work on entries:

```ts
/**
 * Read, and with a positive price. A total of 0 (what the model writes when a quote states none), negative or not a
 * number never ranks: the quote waits for the user's total, like one whose amounts don't add up.
 */
const isRankable = (e: Entry): boolean =>
  e.extraction !== null && hasTotal(e.total) &&
  (e.quote.status === 'ready' || (e.quote.status === 'needs_review' && e.quote.totalOverride !== null))

/** The currency most rankable quotes use, counting each file once; a tie goes to the earliest quote's currency. */
function mainCurrency(entries: readonly Entry[]): string | null {
  const quotes = [...new Map(entries.map((e) => [e.quote.id, e.quote])).values()]
  // …the existing body, unchanged, over `quotes`…
}

/** Why an entry is not ranked. A rankable entry that got here can only be in another currency, whatever its status. */
function unrankedReason(e: Entry): UnrankedReason {
  if (isPending(e.quote.status)) return 'reading'
  if (isRankable(e)) return 'other_currency'
  if (e.optionId !== null) return 'no_price'
  if (e.extraction !== null && (e.quote.status === 'needs_review' || e.quote.status === 'ready')) return hasTotal(e.total) ? 'needs_review' : 'no_total'
  return 'failed'
}

function score(e: Entry, kit: KitNeeds, musts: Musts, currency: string): Scored {
  const items = checkItems(e.extraction!, kit, e.quote.overrides)
  // …unchanged…
  return {
    quote: e.quote, name: quoteName(e.quote), ...optionOf(e), items, fit, currency,
    total: e.total!,
    // …unchanged…
  }
}
```

In `compareQuotes`:

```ts
  const entries = quotes.flatMap(entriesOf)
  const rankable = entries.filter(isRankable)
  const currency = mainCurrency(rankable)
  const inCurrency = rankable.filter((e) => e.extraction!.currency === currency)
  const unranked: UnrankedQuote[] = entries
    .filter((e) => !inCurrency.includes(e))
    .map((e) => ({ quote: e.quote, name: quoteName(e.quote), ...optionOf(e), reason: unrankedReason(e), currency: e.extraction?.currency ?? null }))

  const scored = currency === null ? [] : inCurrency.map((e) => score(e, kit, musts, currency))
```

The rest (sorting, `best`, `worthAsking`, `closest`, and `readCount` / `failedCount` over `quotes`) is unchanged. Remove the now-unused module-level `totalOf` only if nothing uses it; `entriesOf` does, so it stays.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/lib/quote-compare.test.ts && npm run typecheck`
Expected: the tests pass. The typecheck may fail in `quote-jobs.test.ts` or the components; those are fixed in Tasks 5–6, so note them and move on only if every error is about the new fields.

Run: `npm test`
Expected: PASS. (`quote-text.test.ts` doesn't construct `RankedQuote` literals; if a test does, spread `{ optionId: null, optionLabel: null, optionCount: 0 }` into it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/quote-compare.ts src/lib/quote-compare.test.ts
git commit -m "feat: rank each option of a quote that offers several systems as its own entry"
```

---

### Task 5: Words for options, the project line, and Read again

**Files:**
- Modify: `src/i18n/quotes-en.ts`, `src/i18n/quotes-es.ts`
- Modify: `src/lib/quote-text.ts`
- Modify: `src/lib/quote-jobs.ts`
- Modify: `src/lib/quote-guards.ts`
- Test: `src/lib/quote-text.test.ts`, `src/lib/quote-jobs.test.ts`, `src/lib/quote-guards.test.ts`

**Interfaces:**
- Consumes: `entryKey`, `entryName`, `EntryOption`, `quoteSubtitle` (Task 4).
- Produces:
  - `entrySubtitle(t: Dictionary, e: EntryOption & { quote: QuoteView }): string | null`
  - `deleteConfirmText(t: Dictionary, optionCount: number): string`
  - `ProjectJobs['best']: { name: string; optionLabel: string | null; total: number; currency: string } | null`
  - `RETRYABLE = ['failed', 'needs_review']`
  - Quote keys: `optionOf`, `noPrice`, `deleteConfirmOptions`, `readAgain`, `optionsReviewHelp`.

- [ ] **Step 1: Add the strings**

`src/i18n/quotes-en.ts`. Put `deleteConfirmOptions` after `deleteConfirm`, `readAgain` after `retry`, `noPrice` after `otherCurrency`, and `optionOf` and `optionsReviewHelp` after `noTotalHelp`:

```ts
  deleteConfirmOptions: 'Delete this quote, its {count} options and its file?',
  readAgain: 'Read again',
  noPrice: 'No price for this option',
  optionOf: 'Option {n} of {count}',
  optionsReviewHelp: "This quote offers {count} systems, but we couldn't read their prices with confidence. Read it again, or upload a clearer copy.",
```

`src/i18n/quotes-es.ts`, at the same places:

```ts
  deleteConfirmOptions: '¿Eliminar esta cotización, sus {count} opciones y su archivo?',
  readAgain: 'Leer de nuevo',
  noPrice: 'Sin precio para esta opción',
  optionOf: 'Opción {n} de {count}',
  optionsReviewHelp: 'Esta cotización ofrece {count} sistemas, pero no pudimos leer sus precios con seguridad. Léela de nuevo o sube una copia más clara.',
```

- [ ] **Step 2: Write the failing tests**

`src/lib/quote-text.test.ts`. Add `deleteConfirmText, entrySubtitle` to the import from `./quote-text`, and add `entryKey` to the import from `./quote-compare`:

```ts
describe('a quote that offers two systems', () => {
  const suna: QuoteView = { ...view('suna', 9), fileName: 'suna.pdf' }
  const both = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', 0), suna])
  const o2 = both.ranked.find((r) => r.optionId === 'o2')!
  test('the subtitle says which option, its label and the file, in English and Spanish', () => {
    expect(entrySubtitle(en, o2)).toBe('Option 2 of 2 · Inversor 10 kW · suna.pdf')
    expect(entrySubtitle(es, o2)).toBe('Opción 2 de 2 · Inversor 10 kW · suna.pdf')
  })
  test('a single-system quote keeps the file name as its subtitle', () => {
    expect(entrySubtitle(en, both.best!)).toBe('solartec.pdf')
  })
  test('asking about the option names it, while the question to the installer greets the vendor', () => {
    expect(askText(en, o2, both)).toContain('SUNA M.P. · Inversor 10 kW')
    expect(questionText(en, o2)).toMatch(/^Hi SUNA M\.P\., /)
  })
  test('the best fit is told apart by option, not by quote', () => {
    const alone = compareQuotes(KIT, { ...DEFAULT_MUSTS, battery: false, charger: false, cables: false, fuse: false, installation: false }, [suna])
    const [first, second] = alone.ranked as [RankedQuote, RankedQuote]
    expect(entryKey(alone.best!)).toBe('suna:o2')
    expect(fitLabel(en, first, alone)).toBe(en.quotes.bestFit)
    expect(fitLabel(en, second, alone)).not.toBe(en.quotes.bestFit)
    expect(verdictHeading(en, alone)).toBe('SUNA M.P. · Inversor 10 kW fits your kit for the least')
  })
  test('the delete confirmation counts the options it removes', () => {
    expect(deleteConfirmText(en, 0)).toBe('Delete this quote and its file?')
    expect(deleteConfirmText(en, 2)).toBe('Delete this quote, its 2 options and its file?')
    expect(deleteConfirmText(es, 2)).toBe('¿Eliminar esta cotización, sus 2 opciones y su archivo?')
  })
  test('the project line names the best option', () => {
    const j = { ...jobs(), best: { name: 'SUNA M.P.', optionLabel: 'Inversor 10 kW', total: 6200, currency: 'USD' } }
    expect(projectLine(en, j)).toBe('Verdict ready · SUNA M.P. · Inversor 10 kW · $6,200')
  })
})
```

If the file has no `jobs()` helper for a `ProjectJobs`, define one at the top of this `describe`:
`const jobs = (): ProjectJobs => ({ projectId: 'p', projectName: 'Home', files: [], total: 1, done: 1, pending: 0, failed: 0, needsReview: 0, kitEmpty: false, unseen: false, best: null })`. Any existing `best: { name, total, currency }` literal in this file gains `optionLabel: null`.

`src/lib/quote-jobs.test.ts`: change the existing expectation to `toEqual({ name: 'SolarTec Caribe', optionLabel: null, total: 6480, currency: 'USD' })`, and add:

```ts
  test('names the option when the best entry is one', () => {
    const musts = { ...DEFAULT_MUSTS, battery: false, charger: false, cables: false, fuse: false, installation: false }
    const suna = jq('suna', { extraction: SAMPLE_QUOTES.suna })
    expect(summarizeProject('p', 'Home', [suna], KIT, musts).best).toEqual({ name: 'SUNA M.P.', optionLabel: 'Inversor 10 kW', total: 6200, currency: 'USD' })
  })
```

(Import `SAMPLE_QUOTES` from `./quote-fixtures` if the file doesn't already.)

`src/lib/quote-guards.test.ts`:
- change `expect(RETRYABLE).toEqual(['failed'])` to `toEqual(['failed', 'needs_review'])`;
- in "a quote that was read, or is being read, cannot be retried", loop over `['queued', 'processing', 'ready']` only and rename it "a quote being read, or read and ready, cannot be retried";
- add:

```ts
  test('a quote whose numbers need checking can be read again, until it has used its retries', () => {
    expect(canRetry({ status: 'needs_review', retries: 0 })).toBe(true)
    expect(retryOffer({ status: 'needs_review', retries: 0 }, true)).toBe('retry')
    expect(retryOffer({ status: 'needs_review', retries: MAX_RETRIES }, true)).toBe('used_up')
    expect(retryOffer({ status: 'needs_review', retries: 0 }, false)).toBe('none')
  })
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/quote-text.test.ts src/lib/quote-jobs.test.ts src/lib/quote-guards.test.ts`
Expected: FAIL: the missing exports, `RETRYABLE`, `optionLabel` and the heading text.

- [ ] **Step 4: Implement the text** (`src/lib/quote-text.ts`)

Imports: `import { entryKey, entryName, nothingRead, quoteSubtitle, type EntryOption, type QuoteView, type RankedQuote, type UnrankedQuote, type Verdict } from './quote-compare'`.

```ts
const isBest = (r: RankedQuote, v: Verdict): boolean => v.best !== null && entryKey(v.best) === entryKey(r)
```

- `verdictHeading`: `trq(t, 'headingBest', { name: entryName(v.best) })`
- `verdictSubline`: `trq(t, 'subNone', { name: entryName(v.closest), gap: … })`
- `askText`: both `name: r.name` become `name: entryName(r)`
- `questionText`: unchanged (it greets the installer).
- `projectLine`: `` trq(t, 'lineReady', { best: `${entryName(j.best)} · ${money(t, j.best.total, j.best.currency)}` }) ``

Add after `totalHelp`:

```ts
const SUBTITLE_SEPARATOR = ' · '

/**
 * A card's second line: for an option, which of the quote's options it is, its label and the file ("Option 2 of 2 ·
 * Inversor 10 kW · suna.pdf"); otherwise the file name, unless it already is the card's name.
 */
export function entrySubtitle(t: Dictionary, e: EntryOption & { quote: QuoteView }): string | null {
  if (e.optionId === null) return quoteSubtitle(e.quote)
  const n = (e.quote.extraction?.options.findIndex((o) => o.id === e.optionId) ?? 0) + 1
  return [trq(t, 'optionOf', { n, count: e.optionCount }), e.optionLabel, e.quote.fileName].filter(Boolean).join(SUBTITLE_SEPARATOR)
}

/** Deleting a quote with options removes every option's card with the file, so the confirmation says how many. */
export function deleteConfirmText(t: Dictionary, optionCount: number): string {
  return optionCount > 0 ? trq(t, 'deleteConfirmOptions', { count: optionCount }) : t.quotes.deleteConfirm
}
```

- [ ] **Step 5: Implement the project summary and the guards**

`src/lib/quote-jobs.ts`:
- the type becomes `best: { name: string; optionLabel: string | null; total: number; currency: string } | null`;
- the builder becomes `const best = verdict?.best ? { name: verdict.best.name, optionLabel: verdict.best.optionLabel, total: verdict.best.total, currency: verdict.best.currency } : null`.

`src/lib/quote-guards.ts`:

```ts
/**
 * A quote the model gave up on can be retried, and one whose numbers need checking can be read again (a reading from
 * before options, for one). A ready quote stays until it is deleted.
 */
export const RETRYABLE: readonly QuoteStatus[] = ['failed', 'needs_review']
```

Update `retryOffer`'s doc comment from "a failed quote's row" to "a failed or needs-review quote's card". `retryWithinBudget` (`src/server/quotes/limits.ts`) reads `RETRYABLE`, so the server allows the same; update its doc comment's "Queues a failed quote" to "Queues a failed or needs-review quote". A read that ends `ready` replaces the extraction (`repo.ts` `finish`); `totalOverride` is untouched by the retry SQL, so a typed total is kept.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/quote-text.test.ts src/lib/quote-jobs.test.ts src/lib/quote-guards.test.ts && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/quotes-en.ts src/i18n/quotes-es.ts src/lib/quote-text.ts src/lib/quote-text.test.ts src/lib/quote-jobs.ts src/lib/quote-jobs.test.ts src/lib/quote-guards.ts src/lib/quote-guards.test.ts src/server/quotes/limits.ts
git commit -m "feat: words for a quote's options, the best option on the project line, and Read again for quotes to check"
```

---

### Task 6: Cards for options

**Files:**
- Modify: `src/components/quotes/VerdictView.tsx`
- Modify: `src/components/quotes/QuoteRow.tsx`
- Modify: `src/components/quotes/BestCard.tsx`
- Modify: `src/components/quotes/UnrankedRow.tsx`
- Modify: `src/components/quotes/QuoteActions.tsx`

**Interfaces:**
- Consumes: `entryKey`, `entryName` (Task 4); `entrySubtitle`, `deleteConfirmText`, the new keys and `RETRYABLE` (Task 5).
- Produces: `QuoteActions` props `{ quoteId: string; optionCount: number; onDelete: () => void }`.

There is no component test harness in this repo (cards are covered by E2E in Task 7), so this task is verified by the typecheck, the full unit suite and a look in the browser.

- [ ] **Step 1: `QuoteActions.tsx`**

```tsx
import { deleteConfirmText } from '../../lib/quote-text'

/** View original, and Delete behind a confirmation, since deleting also removes the file, and every option's card, for good. */
export function QuoteActions({ quoteId, optionCount, onDelete }: { quoteId: string; optionCount: number; onDelete: () => void }) {
  // …
          <span className="qrow__confirm" role="alert">{deleteConfirmText(t, optionCount)}</span>
```

- [ ] **Step 2: `QuoteRow.tsx` and `BestCard.tsx`**

Both: replace `quoteSubtitle` with `entrySubtitle` (imported from `quote-text`), and pass the entry:

```tsx
const subtitle = entrySubtitle(t, r)            // QuoteRow
const subtitle = entrySubtitle(t, best)         // BestCard
```

- `ChecksToggle name={entryName(r)}` / `name={entryName(best)}`, so two option cards' toggles have different accessible names.
- `<QuoteActions quoteId={r.quote.id} optionCount={r.optionCount} onDelete={onDelete} />` (same in BestCard with `best`).
- In `QuoteRow`, `const isAsking = verdict.worthAsking.some((w) => entryKey(w) === entryKey(r))`.

- [ ] **Step 3: `UnrankedRow.tsx`**

```tsx
  const waitsForTotal = u.reason === 'needs_review' || u.reason === 'no_total'
  // A typed total would belong to neither of a quote's systems, so a quote with options gets Read again instead of the form.
  const hasTotalForm = waitsForTotal && u.optionCount === 0
  const canReadAgain = u.quote.status === 'needs_review' && retry === 'retry'
  const pill = u.reason === 'reading'
    ? { cls: 'qpill qpill--run', text: fileStatusText(t, u.quote.status) }
    : u.reason === 'other_currency'
      ? { cls: 'qpill qpill--unk', text: trq(t, 'otherCurrency', { currency: u.currency ?? '' }) }
      : u.reason === 'no_price'
        ? { cls: 'qpill qpill--warn', text: t.quotes.noPrice }
        : { cls: 'qpill qpill--warn', text: fileStatusText(t, u.quote.status) }
  const subtitle = entrySubtitle(t, u)
```

- The form renders when `hasTotalForm` (it was `u.reason === 'needs_review' || u.reason === 'no_total'`).
- Below it, add: `{waitsForTotal && u.optionCount > 0 && <p className="qmeta">{trq(t, 'optionsReviewHelp', { count: u.optionCount })}</p>}`.
- In the actions, before the failed Retry, add: `{canReadAgain && <button type="button" className="qbtn" onClick={onRetry}>{t.quotes.readAgain}</button>}`.
- The failed `retry` and `used_up` lines stay as they are: the "after several tries" note shows only for a failed quote.
- `<QuoteActions quoteId={u.quote.id} optionCount={u.optionCount} onDelete={onDelete} />`.
- Update the `retry` prop's doc comment: "Retry for a failed quote and Read again for one to check; a note that a failed quote used its retries; or nothing, for an account that may not start reads."

- [ ] **Step 4: `VerdictView.tsx`**

Import `entryKey` from `quote-compare`. Saves go to the quote; errors show on the card that made them.

```tsx
  const onOverride = (quoteId: string, key: string) => async (item: ItemId, value: Override | null) => {
    // …unchanged, except the last line of the catch:
      failed(key)
  }
```

```tsx
  const others = verdict.best ? verdict.ranked.filter((r) => entryKey(r) !== entryKey(verdict.best!)) : verdict.ranked
```

Use `const bestKey = verdict.best ? entryKey(verdict.best) : null` if the non-null assertion reads badly. Then:

```tsx
        {others.map((r) => (
          <QuoteRow key={entryKey(r)} r={r} verdict={verdict} kit={kit} error={errorFor(entryKey(r))}
            onOverride={onOverride(r.quote.id, entryKey(r))} onDelete={remove(r.quote.id, entryKey(r))} />
        ))}
```

```tsx
          <BestCard best={verdict.best} kit={kit} error={errorFor(entryKey(verdict.best))}
            onOverride={onOverride(verdict.best.quote.id, entryKey(verdict.best))} onDelete={remove(verdict.best.quote.id, entryKey(verdict.best))} />
```

```tsx
  const remove = (quoteId: string, key: string) => run(key, () => deleteQuote({ data: { quoteId } }))
```

```tsx
            {verdict.unranked.map((u) => (
              <UnrankedRow key={entryKey(u)} u={u} error={errorFor(entryKey(u))} retry={retryFor(u.quote.id)}
                onRetry={run(entryKey(u), () => retryQuote({ data: { quoteId: u.quote.id } }))}
                onDelete={remove(u.quote.id, entryKey(u))}
                onTotal={(total) => void run(entryKey(u), () => setQuoteTotal({ data: { quoteId: u.quote.id, total } }))()} />
            ))}
```

- [ ] **Step 5: Typecheck, unit tests, lint**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass, and no remaining `quoteSubtitle` imports in `src/components` (`rg -n quoteSubtitle src/components` prints nothing).

- [ ] **Step 6: Look at it**

Start the dev server with the stub model (`preview_start`; the stub needs `QUOTES_MODEL_STUB=1`, as the E2E config sets it). Upload `solartec.pdf` and `suna.pdf` to a kit, open the verdict, and check at 390 px wide:
- two SUNA cards with "Option 1 of 2 · Inversor 3 kW · suna.pdf" and "Option 2 of 2 · Inversor 10 kW · suna.pdf";
- no total form;
- Delete → "Delete this quote, its 2 options and its file?" on one card only.

- [ ] **Step 7: Commit**

```bash
git add src/components/quotes/VerdictView.tsx src/components/quotes/QuoteRow.tsx src/components/quotes/BestCard.tsx src/components/quotes/UnrankedRow.tsx src/components/quotes/QuoteActions.tsx
git commit -m "feat: a card per option, keyed by option, with Read again for quotes to check"
```

---

### Task 7: End-to-end

**Files:**
- Modify: `e2e/db.ts`
- Modify: `e2e/quotes.spec.ts`

**Interfaces:**
- Consumes: everything above; the stub reads `suna.pdf` as `SAMPLE_QUOTES.suna`.
- Produces: `stripQuoteOptions(email: string, projectId: string): Promise<void>` in `e2e/db.ts`.

- [ ] **Step 1: Add the database helper** (`e2e/db.ts`, after `setQuoteRetries`)

```ts
/**
 * Turns a project's quotes back into readings made before options existed: no options, no line options, and waiting
 * for a total, as the user's SUNA quote was stored.
 */
export async function stripQuoteOptions(email: string, projectId: string): Promise<void> {
  await testDb()`
    update quotes q set status = 'needs_review',
      extraction = jsonb_set(q.extraction - 'options', '{lines}',
        coalesce((select jsonb_agg(l - 'option') from jsonb_array_elements(q.extraction -> 'lines') l), '[]'::jsonb))
    from "user" u where u.id = q.user_id and u.email = ${email} and q.project_id = ${projectId}`
}
```

- [ ] **Step 2: Write the two tests** (`e2e/quotes.spec.ts`; import `stripQuoteOptions`)

```ts
const SUNA_O1 = 'Option 1 of 2 · Inversor 3 kW · suna.pdf'
const SUNA_O2 = 'Option 2 of 2 · Inversor 10 kW · suna.pdf'

test('a quote that offers two systems shows a card for each, priced on its own, and asks for no total', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, await Promise.all(['solartec', 'suna'].map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  const suna = page.getByRole('article').filter({ hasText: 'SUNA M.P.' })
  await expect(suna).toHaveCount(2)
  const small = suna.filter({ hasText: SUNA_O1 })
  const large = suna.filter({ hasText: SUNA_O2 })
  await expect(small).toContainText('$2,600')
  await expect(small).toContainText(quotesEn.fitShort)
  await expect(large).toContainText('$6,200')
  await expect(large).toContainText('unclear')
  await expect(large.getByRole('img', { name: /^Inverter: / })).toBeVisible()
  await expect(page.getByLabel(quotesEn.totalInQuote)).toHaveCount(0)
})

test('a quote read before options can be read again, and then shows a card per option', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('suna')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(page.getByText(SUNA_O2)).toBeVisible({ timeout: 30_000 })

  await stripQuoteOptions(email, projectId)
  await page.reload()
  const row = page.getByRole('article').filter({ hasText: 'suna.pdf' })
  await expect(row.getByText(quotesEn.noTotalHelp)).toBeVisible()
  await row.getByRole('button', { name: quotesEn.readAgain }).click()

  await expect(page.getByText(SUNA_O1)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(SUNA_O2)).toBeVisible()
  expect(await quoteRetryStates(email, projectId)).toEqual([{ status: 'ready', retries: 1 }])
})
```

The inverter sizing bar's accessible name comes from `gaugeLabel` ("Inverter: … needed, …"). If `SizingBars` labels its bars differently, match its actual role and name, the way the phone-layout test at the end of this file does.

- [ ] **Step 3: Run the two tests**

Run: `npx playwright test e2e/quotes.spec.ts -g "two systems|read before options"`
Expected: both PASS. If the first fails on `toHaveCount(2)` because an `article` from the tray matches, scope it with `page.getByRole('main')`, as other tests in the file do.

- [ ] **Step 4: Run the whole quotes E2E file**

Run: `npx playwright test e2e/quotes.spec.ts`
Expected: PASS. The retry test still clicks "Retry" on a failed quote, which is unchanged.

- [ ] **Step 5: Commit**

```bash
git add e2e/db.ts e2e/quotes.spec.ts
git commit -m "test: e2e for a quote with two systems, and reading an old quote again"
```

---

## After the last task

- Update the spec's header: `Status: Approved` and `Branch: claude/continuing-work-907a55 (rebased onto main after PR #6)`. Commit it as `docs: …`.
- Whole-branch review, then a PR. After the Preview deploys, the user reads the real SUNA quote again with **Read again** and checks the two cards. That is the acceptance test for the prompt rules (spec §6).
