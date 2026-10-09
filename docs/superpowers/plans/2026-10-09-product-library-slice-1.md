# Product library, slice 1: schema, table, token API and the research skill

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task by task.

Spec: `docs/superpowers/specs/2026-10-09-product-library-design.md` (sections "Admin research skill", "Data model", "Decisions").

**Goal:** an admin can run `/research-product EG4 6000XP`, see every datasheet value with its quote and source, confirm, and have the product stored in a `products` table through a token-protected endpoint.

**Architecture:** a shared Zod schema (`src/lib/product-schema.ts`) defines a product as the datasheet states it: every spec is `{ value, source, asWritten }`, and surge is a list of levels. Pure merge rules (`src/lib/product-merge.ts`) decide what a write fills, keeps, replaces or records as a conflict. A thin repo and a route behind the appliance API's `authorize()` expose `GET` and `POST ?dryRun&replace`. The skill is a Markdown runbook like `/research-appliance`.

**Tech stack:** TypeScript, Zod 4.6, Drizzle (neon-http), TanStack Start server routes, Vitest, Playwright.

**Safety, read before any database step:**
- `.env.local` points at the **production** database. Never run `npm run db:migrate` locally.
- The e2e database is the Neon `e2e` branch in `.env.test.local`. Migrate it only with `scripts/migrate-test-db.ts` (Task 6), which goes through e2e's production guard.
- Never print a database URL or a token.

Each task runs test-first where there is logic: write the test, run it red, implement, run it green, commit.

---

### Task 0: Worktree setup

**Step 1:** link the env files the main checkout keeps (e2e refuses to run without them):

```bash
ln -s ../../../.env.test.local .env.test.local && ln -s ../../../.env.local .env.local
```

**Step 2:** baseline. Run `npm test`. Expected: all pass.

---

### Task 1: Move `stable()` out of the appliance diff

Both diffs need JSON with sorted keys, so jsonb's key reordering never reads as a change.

**Files:**
- Create: `src/lib/stable-json.ts`
- Modify: `src/lib/catalog-diff.ts` (delete its local `stable`, import it)

**Step 1:** create `src/lib/stable-json.ts`:

```ts
/** JSON with object keys sorted, so jsonb's key reordering never reads as a change. Undefined reads as null. */
export function stable(v: unknown): string {
  if (v === undefined || v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
}
```

**Step 2:** in `catalog-diff.ts`, remove the `stable` function and add `import { stable } from './stable-json'`.

**Step 3:** `npx vitest run src/lib/catalog-diff.test.ts`. Expected: PASS, unchanged behaviour.

**Step 4:** commit `refactor: share stable JSON between catalog diffs`.

---

### Task 2: The product schema and its key

**Files:**
- Create: `src/lib/product-schema.ts`
- Test: `src/lib/product-schema.test.ts`

**Step 1: write the failing tests** (`src/lib/product-schema.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { ProductInputSchema, productKey } from './product-schema'
import { battery, inverter, stated } from './product-fixtures'

describe('ProductInputSchema', () => {
  test('accepts an inverter and a battery as the datasheet states them', () => {
    expect(ProductInputSchema.safeParse(inverter()).success).toBe(true)
    expect(ProductInputSchema.safeParse(battery()).success).toBe(true)
  })

  test('a stated value needs its source and its words as written', () => {
    const p = inverter({ continuousW: { value: 6000, source: null, asWritten: null } })
    expect(ProductInputSchema.safeParse(p).success).toBe(false)
  })

  test('sources must be https', () => {
    const p = inverter({ continuousW: { ...stated(6000, 'Rated power 6000W'), source: 'http://example.com/sheet.pdf' } })
    expect(ProductInputSchema.safeParse(p).success).toBe(false)
  })

  test('keeps at most 8 extra datasheet lines', () => {
    const line = { name: 'IP rating', value: 'IP20', source: 'https://example.com/sheet.pdf' }
    const p = { ...inverter(), extraSpecs: Array.from({ length: 9 }, (_, i) => ({ ...line, name: `Line ${i}` })) }
    expect(ProductInputSchema.safeParse(p).success).toBe(false)
  })

  test('refuses a value past the sanity cap (a slipped unit or digit)', () => {
    expect(ProductInputSchema.safeParse(inverter({ continuousW: stated(6_000_000, '6000kW') })).success).toBe(false)
  })

  test('refuses a model with no letters or digits', () => {
    expect(ProductInputSchema.safeParse({ ...inverter(), model: '—' }).success).toBe(false)
  })
})

describe('productKey', () => {
  test('one maker whatever the brand spelling', () => {
    expect(productKey({ kind: 'inverter', brand: 'EG4', model: '6000XP' }))
      .toBe(productKey({ kind: 'inverter', brand: 'EG4 Electronics', model: '6000XP' }))
  })

  test('ignores case, spaces, punctuation, accents and a repeated brand in the model', () => {
    expect(productKey({ kind: 'inverter', brand: 'EG4', model: '18kPV-12LV' })).toBe('inverter:eg4:18kpv12lv')
    expect(productKey({ kind: 'battery', brand: 'Pytes', model: 'Pytes V5' })).toBe('battery:pytes:v5')
    expect(productKey({ kind: 'battery', brand: 'Batería Ñ', model: 'Módulo 5' })).toBe('battery:bateria:modulo5')
  })

  test('the kind is part of the key', () => {
    expect(productKey({ kind: 'battery', brand: 'EG4', model: '6000XP' })).not.toBe(productKey({ kind: 'inverter', brand: 'EG4', model: '6000XP' }))
  })
})
```

Shared fixtures go in `src/lib/product-fixtures.ts` (the merge tests reuse them; like `quote-fixtures.ts`, they are not a test file, so coverage counts them):

```ts
import type { BatterySpecs, InverterSpecs, ProductInput } from './product-schema'

export const SHEET = 'https://example.com/sheet.pdf'
export const NONE = { value: null, source: null, asWritten: null }
export const stated = <T>(value: T, asWritten: string) => ({ value, source: SHEET, asWritten })

export function inverter(specs: Partial<InverterSpecs> = {}): Extract<ProductInput, { kind: 'inverter' }> {
  return {
    kind: 'inverter', brand: 'EG4 Electronics', model: '6000XP', makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      continuousW: stated(6000, 'NOMINAL POWER OUTPUT 6000W'),
      surges: [
        { w: 12000, seconds: 3.5, asWritten: '12,000W for ≈3.5 seconds', source: SHEET },
        { w: 11000, seconds: 5, asWritten: '11,000W for ≈5 seconds', source: SHEET },
      ],
      batteryVolts: stated(48, 'NOMINAL VOLTAGE 48 VDC'), splitPhase: stated(true, '120/240VAC'),
      chargerA: NONE, pvInputW: NONE, pvVocMax: NONE, maxParallelUnits: stated(16, 'MAX. UNITS IN PARALLEL 16'),
      idleW: NONE, peakEfficiencyPct: NONE, warrantyYears: stated(5, '5-YEAR WARRANTY'),
      bmsComms: ['can', 'rs485'], compatibleBatteryBrands: [],
      ...specs,
    },
  }
}

export function battery(specs: Partial<BatterySpecs> = {}): Extract<ProductInput, { kind: 'battery' }> {
  return {
    kind: 'battery', brand: 'Pytes', model: 'V5', makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      chemistry: stated('lifepo4' as const, 'LiFePO4'), nominalV: stated(51.2, 'Nominal Voltage 51.2V'), ah: stated(100, '100Ah'),
      kWh: stated(5.12, '5.12kWh'), maxContinuousA: stated(100, 'Max. continuous discharge 100A'), peakA: NONE, peakSeconds: NONE,
      maxParallel: stated(16, 'Up to 16 in parallel'), cycleLife: NONE, warrantyYears: NONE,
      bmsComms: ['can'], compatibleInverterBrands: [],
      ...specs,
    },
  }
}
```

**Step 2:** `npx vitest run src/lib/product-schema.test.ts`. Expected: FAIL (module not found).

**Step 3: implement** `src/lib/product-schema.ts`:

```ts
import { z } from 'zod'

/** Upper bounds that catch a slipped unit or digit; no real product comes near them. */
export const PRODUCT_LIMITS = {
  WATTS: 100_000, VOLTS: 1000, AMPS: 2000, PERCENT: 100, YEARS: 30, CYCLES: 100_000, SECONDS: 3600, UNITS: 100, KWH: 1000, AH: 5000,
} as const
const MAX_SURGE_LEVELS = 6
const MAX_EXTRA_SPECS = 8
const MAX_BRANDS = 30
const MAX_TEXT = 200

export const PRODUCT_KINDS = ['inverter', 'battery'] as const
export type ProductKind = (typeof PRODUCT_KINDS)[number]
export const PRODUCT_ORIGINS = ['admin', 'search'] as const
export type ProductOrigin = (typeof PRODUCT_ORIGINS)[number]
const BMS_PROTOCOLS = ['can', 'rs485'] as const
const BATTERY_CHEMISTRIES = ['lifepo4', 'agm', 'other'] as const

const httpsUrl = z.url({ protocol: /^https$/, message: 'an https URL' })
const text = (max = MAX_TEXT) => z.string().trim().min(1).max(max)

/**
 * One spec as the datasheet states it: the value, the page it is on and the datasheet's own words. A stated value needs
 * both, so every number can be checked against where it came from. A spec the datasheet does not give is all null.
 */
function spec<T extends z.ZodType>(value: T) {
  return z
    .object({ value: value.nullable(), source: httpsUrl.nullable(), asWritten: text().nullable() })
    .strict()
    .refine((s) => s.value === null || (s.source !== null && s.asWritten !== null), {
      message: 'a stated value needs its source and its words as written',
    })
}
const amount = (max: number) => spec(z.number().positive().max(max))

/** One surge or overload level and how long it holds; w is null for a level the maker gives only in VA. */
const SurgeLevelSchema = z
  .object({
    w: z.number().positive().max(PRODUCT_LIMITS.WATTS).nullable(),
    seconds: z.number().positive().max(PRODUCT_LIMITS.SECONDS).nullable(),
    asWritten: text(),
    source: httpsUrl,
  })
  .strict()
const ExtraSpecSchema = z.object({ name: text(60), value: text(), source: httpsUrl }).strict()
const PriceSchema = z
  .object({ amount: z.number().positive(), currency: z.string().regex(/^[A-Z]{3}$/), seller: text(80), url: httpsUrl, seenOn: z.iso.date() })
  .strict()
const comms = z.array(z.enum(BMS_PROTOCOLS)).max(BMS_PROTOCOLS.length)
const brands = z.array(text(60)).max(MAX_BRANDS)

export const InverterSpecsSchema = z
  .object({
    continuousW: amount(PRODUCT_LIMITS.WATTS),
    /** Every level the maker states, shortest first: "12,000W for ≈3.5 s | 11,000W for ≈5 s" is two. */
    surges: z.array(SurgeLevelSchema).max(MAX_SURGE_LEVELS),
    batteryVolts: amount(PRODUCT_LIMITS.VOLTS),
    splitPhase: spec(z.boolean()),
    chargerA: amount(PRODUCT_LIMITS.AMPS),
    pvInputW: amount(PRODUCT_LIMITS.WATTS),
    pvVocMax: amount(PRODUCT_LIMITS.VOLTS),
    maxParallelUnits: amount(PRODUCT_LIMITS.UNITS),
    idleW: amount(PRODUCT_LIMITS.WATTS),
    peakEfficiencyPct: amount(PRODUCT_LIMITS.PERCENT),
    warrantyYears: amount(PRODUCT_LIMITS.YEARS),
    bmsComms: comms,
    /** Only brands the maker itself lists as compatible. */
    compatibleBatteryBrands: brands,
  })
  .strict()

export const BatterySpecsSchema = z
  .object({
    chemistry: spec(z.enum(BATTERY_CHEMISTRIES)),
    /** As the datasheet states it (51.2 V for a "48 V" LiFePO₄ unit), not the system class. */
    nominalV: amount(PRODUCT_LIMITS.VOLTS),
    ah: amount(PRODUCT_LIMITS.AH),
    kWh: amount(PRODUCT_LIMITS.KWH),
    maxContinuousA: amount(PRODUCT_LIMITS.AMPS),
    peakA: amount(PRODUCT_LIMITS.AMPS),
    peakSeconds: amount(PRODUCT_LIMITS.SECONDS),
    maxParallel: amount(PRODUCT_LIMITS.UNITS),
    cycleLife: amount(PRODUCT_LIMITS.CYCLES),
    warrantyYears: amount(PRODUCT_LIMITS.YEARS),
    bmsComms: comms,
    compatibleInverterBrands: brands,
  })
  .strict()

const common = {
  brand: text(60),
  model: text(80),
  makerUrl: httpsUrl.nullable(),
  /** Required: the library is a reference users can check, so every product links its datasheet. */
  datasheetUrl: httpsUrl,
  extraSpecs: z.array(ExtraSpecSchema).max(MAX_EXTRA_SPECS),
  price: PriceSchema.nullable(),
}

export const ProductInputSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('inverter'), ...common, specs: InverterSpecsSchema }).strict(),
    z.object({ kind: z.literal('battery'), ...common, specs: BatterySpecsSchema }).strict(),
  ])
  .refine((p) => normalize(p.model) !== '', { path: ['model'], message: 'the model needs letters or digits' })

/** A value a later write read differently from the stored one, kept for the admin to settle. */
export const ProductConflictSchema = z.object({
  field: z.string(), found: z.unknown(), source: z.string().nullable(), seenAt: z.iso.datetime(),
})

export type ProductInput = z.infer<typeof ProductInputSchema>
export type InverterSpecs = z.infer<typeof InverterSpecsSchema>
export type BatterySpecs = z.infer<typeof BatterySpecsSchema>
export type SurgeLevel = z.infer<typeof SurgeLevelSchema>
export type ExtraSpec = z.infer<typeof ExtraSpecSchema>
export type ProductConflict = z.infer<typeof ProductConflictSchema>
export type ProductRecord = ProductInput & { id: string; key: string; origin: ProductOrigin; conflicts: ProductConflict[]; retired: boolean }

/** Lowercase letters and digits only, accents dropped. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The product's identity: kind, the brand's first word ("EG4" and "EG4 Electronics" are one maker) and the model
 * without a repeated brand ("Pytes V5" is "V5"). The skill also reuses a stored product's spelling; this catches the rest.
 */
export function productKey(p: Pick<ProductInput, 'kind' | 'brand' | 'model'>): string {
  const brand = normalize(p.brand.trim().split(/\s+/)[0] ?? '')
  const model = normalize(p.model)
  const withoutBrand = brand && model.startsWith(brand) && model.length > brand.length ? model.slice(brand.length) : model
  return `${p.kind}:${brand}:${withoutBrand}`
}
```

**Step 4:** `npx vitest run src/lib/product-schema.test.ts`. Expected: PASS. If Zod rejects `spec()`'s generic, type it as `spec<T extends z.ZodType>(value: T)` returning the inferred object; don't widen to `any`.

**Step 5:** commit `feat: product schema with sourced datasheet specs and a product key`.

---

### Task 3: Parse a batch

**Files:**
- Modify: `src/lib/product-schema.ts` (append)
- Test: `src/lib/product-schema.test.ts` (append)

**Step 1: failing tests**:

```ts
describe('parseProducts', () => {
  test('takes one product or an array of up to 50', () => {
    expect(parseProducts(inverter())).toMatchObject({ ok: true, items: [expect.objectContaining({ model: '6000XP' })] })
    expect(parseProducts([])).toMatchObject({ ok: false })
    expect(parseProducts(Array.from({ length: 51 }, (_, i) => ({ ...inverter(), model: `M${i}` })))).toMatchObject({ ok: false })
  })

  test('reports issues per index with a dotted path', () => {
    const bad = inverter({ continuousW: { value: 6000, source: null, asWritten: null } })
    const out = parseProducts([battery(), bad])
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.errors[0]!.index).toBe(1)
    expect(out.errors[0]!.issues[0]!.path).toBe('specs.continuousW')
  })

  test('refuses two items with the same key', () => {
    const out = parseProducts([inverter(), { ...inverter(), brand: 'EG4' }])
    expect(out).toMatchObject({ ok: false, errors: [{ index: 1, issues: [{ path: 'model', message: 'the same product twice in this request' }] }] })
  })
})
```

**Step 2:** run, expect FAIL (`parseProducts` not exported).

**Step 3: implement** (append to `product-schema.ts`):

```ts
const MAX_BATCH = 50

export type ParsedProducts =
  | { ok: true; items: ProductInput[] }
  | { ok: false; errors: Array<{ index: number; issues: Array<{ path: string; message: string }> }> }

export function parseProducts(body: unknown): ParsedProducts {
  const list = Array.isArray(body) ? body : [body]
  if (list.length === 0 || list.length > MAX_BATCH) {
    return { ok: false, errors: [{ index: -1, issues: [{ path: '', message: `send 1 to ${MAX_BATCH} products` }] }] }
  }
  const results = list.map((item) => ProductInputSchema.safeParse(item))
  const errors = results.flatMap((r, index) =>
    r.success ? [] : [{ index, issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) }],
  )
  if (errors.length > 0) return { ok: false, errors }
  const items = results.map((r) => r.data!)
  const seen = new Set<string>()
  const duplicates = items.flatMap((item, index) => {
    const key = productKey(item)
    if (seen.has(key)) return [{ index, issues: [{ path: 'model', message: 'the same product twice in this request' }] }]
    seen.add(key)
    return []
  })
  return duplicates.length > 0 ? { ok: false, errors: duplicates } : { ok: true, items }
}
```

**Step 4:** run, expect PASS. **Step 5:** commit `feat: parse a batch of products`.

---

### Task 4: Merge rules

**Files:**
- Create: `src/lib/product-merge.ts`
- Test: `src/lib/product-merge.test.ts`

The rules (spec, "Merging"):
- New key: the product as sent.
- Each spec: an incoming null keeps the stored value. A stored null takes the incoming value (a **fill**). Equal values are unchanged. Different values keep the stored one and become a **conflict**, unless `replace`, when the incoming one wins (a **replace**).
- Values compare by `value` only: different words or source for the same number are not a conflict. Surge levels compare by `w` and `seconds`; lists compare sorted, case-insensitive.
- `makerUrl` fills; `datasheetUrl` conflicts or replaces like a spec.
- Extra lines merge by name (case-insensitive): a new name is a fill, a different value under a known name is a conflict. Never more than 8.
- Price is dated and secondary: a different incoming price takes its place and is listed as a fill of `price`.
- The row's stored conflicts drop every field this write filled or replaced, and gain the new ones (one per field and value).

**Step 1: failing tests** (`src/lib/product-merge.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { mergeProduct } from './product-merge'
import { battery, inverter, NONE, SHEET, stated } from './product-fixtures'
import { productKey, type ProductInput, type ProductRecord } from './product-schema'

const NOW = '2026-10-09T12:00:00.000Z'
const record = (p: ProductInput, conflicts: ProductRecord['conflicts'] = []): ProductRecord =>
  ({ ...p, id: 'id-1', key: productKey(p), origin: 'admin', conflicts, retired: false })
const merge = (stored: ProductRecord | null, incoming: ProductInput, replace = false) => mergeProduct(stored, incoming, { replace, now: NOW })

describe('mergeProduct', () => {
  test('a new key is stored as sent', () => {
    const out = merge(null, inverter())
    expect(out.change).toEqual({ key: 'inverter:eg4:6000xp', kind: 'inverter', brand: 'EG4 Electronics', model: '6000XP', status: 'new', fills: [], replaced: [], conflicts: [] })
    expect(out.next).toEqual(inverter())
  })

  test('fills a stored null and keeps what the incoming product leaves null', () => {
    const stored = record(inverter({ chargerA: NONE, idleW: stated(50, '~50W') }))
    const out = merge(stored, inverter({ chargerA: stated(125, 'MAX. CHARGE CURRENT 125A'), idleW: NONE }))
    expect(out.change).toMatchObject({ status: 'updated', fills: ['specs.chargerA'], conflicts: [] })
    expect(out.next.kind === 'inverter' && out.next.specs.chargerA.value).toBe(125)
    expect(out.next.kind === 'inverter' && out.next.specs.idleW.value).toBe(50)
  })

  test('the same numbers in other words are unchanged', () => {
    const out = merge(record(inverter()), inverter({ continuousW: stated(6000, 'Rated output 6 kW') }))
    expect(out.change.status).toBe('unchanged')
  })

  test('a different value keeps the stored one and records a conflict', () => {
    const out = merge(record(inverter()), inverter({ continuousW: stated(5000, '5000W') }))
    expect(out.change).toMatchObject({ status: 'conflicts', conflicts: [{ field: 'specs.continuousW', stored: 6000, found: 5000 }] })
    expect(out.next.kind === 'inverter' && out.next.specs.continuousW.value).toBe(6000)
    expect(out.conflicts).toEqual([{ field: 'specs.continuousW', found: 5000, source: SHEET, seenAt: NOW }])
  })

  test('replace writes the incoming value and clears that field’s stored conflicts', () => {
    const old = { field: 'specs.continuousW', found: 5500, source: SHEET, seenAt: '2026-10-01T00:00:00.000Z' }
    const out = merge(record(inverter(), [old]), inverter({ continuousW: stated(5000, '5000W') }), true)
    expect(out.change).toMatchObject({ status: 'updated', replaced: ['specs.continuousW'], conflicts: [] })
    expect(out.next.kind === 'inverter' && out.next.specs.continuousW.value).toBe(5000)
    expect(out.conflicts).toEqual([])
  })

  test('surge levels compare by watts and seconds only', () => {
    const reworded = inverter().specs.surges.map((l) => ({ ...l, asWritten: `${l.w} W, ${l.seconds} s` }))
    expect(merge(record(inverter()), inverter({ surges: reworded })).change.status).toBe('unchanged')
    const other = merge(record(inverter()), inverter({ surges: [{ w: 9000, seconds: 5, asWritten: '9 kW 5 s', source: SHEET }] }))
    expect(other.change).toMatchObject({ status: 'conflicts', conflicts: [{ field: 'specs.surges' }] })
  })

  test('lists compare sorted and case-insensitive', () => {
    expect(merge(record(inverter()), inverter({ bmsComms: ['rs485', 'can'] })).change.status).toBe('unchanged')
    const brands = merge(record(battery({ compatibleInverterBrands: ['EG4'] })), battery({ compatibleInverterBrands: ['eg4'] }))
    expect(brands.change.status).toBe('unchanged')
  })

  test('extra lines merge by name and never pass 8', () => {
    const line = (name: string, value: string) => ({ name, value, source: SHEET })
    const stored = record({ ...inverter(), extraSpecs: [line('IP rating', 'IP20')] })
    const out = merge(stored, { ...inverter(), extraSpecs: [line('ip rating', 'IP65'), line('Weight', '24 kg')] })
    expect(out.change).toMatchObject({ status: 'updated', fills: ['extraSpecs.Weight'], conflicts: [{ field: 'extraSpecs.IP rating', stored: 'IP20', found: 'IP65' }] })
    expect(out.next.extraSpecs.map((l) => l.name)).toEqual(['IP rating', 'Weight'])
    const full = record({ ...inverter(), extraSpecs: Array.from({ length: 8 }, (_, i) => line(`L${i}`, 'x')) })
    expect(merge(full, { ...inverter(), extraSpecs: [line('L9', 'y')] }).next.extraSpecs).toHaveLength(8)
  })

  test('a different price takes the old one’s place as a fill', () => {
    const price = { amount: 1199, currency: 'USD', seller: 'Shop', url: 'https://shop.example.com/p', seenOn: '2026-10-09' }
    const out = merge(record(inverter()), { ...inverter(), price })
    expect(out.change).toMatchObject({ status: 'updated', fills: ['price'] })
    expect(out.next.price).toEqual(price)
  })

  test('a conflict seen again is not stored twice', () => {
    const seen = { field: 'specs.continuousW', found: 5000, source: SHEET, seenAt: '2026-10-01T00:00:00.000Z' }
    const out = merge(record(inverter(), [seen]), inverter({ continuousW: stated(5000, '5000W') }))
    expect(out.conflicts).toEqual([seen])
  })
})
```

**Step 2:** run, expect FAIL.

**Step 3: implement** `src/lib/product-merge.ts`. Every helper returns a new value with its `Outcome`; nothing is pushed into a shared accumulator (the repo's immutability rule):

```ts
import { productKey, type ExtraSpec, type ProductConflict, type ProductInput, type ProductKind, type ProductRecord } from './product-schema'
import { stable } from './stable-json'

const MAX_EXTRA_SPECS = 8

export interface FieldConflict { field: string; stored: unknown; found: unknown }
export type ChangeStatus = 'new' | 'updated' | 'conflicts' | 'unchanged'
export interface ProductChange {
  key: string; kind: ProductKind; brand: string; model: string; status: ChangeStatus
  fills: string[]; replaced: string[]; conflicts: FieldConflict[]
}
/** What a write does to one product: the change to report, the product to store and the row's conflicts list. */
export interface MergeResult { change: ProductChange; next: ProductInput; conflicts: ProductConflict[] }

/** What deciding some fields produced: which were filled or replaced, and the conflicts found. */
interface Outcome { fills: string[]; replaced: string[]; conflicts: FieldConflict[]; found: ProductConflict[] }
interface Decided<T> { value: T; outcome: Outcome }
interface Ctx { replace: boolean; now: string }
/** How a field compares: specs by value, surge levels by watts and seconds, lists sorted. */
interface Field { comparable: unknown; isStated: boolean; source: string | null }

const NOTHING: Outcome = { fills: [], replaced: [], conflicts: [], found: [] }
const combine = (a: Outcome, b: Outcome): Outcome => ({
  fills: [...a.fills, ...b.fills], replaced: [...a.replaced, ...b.replaced],
  conflicts: [...a.conflicts, ...b.conflicts], found: [...a.found, ...b.found],
})
const keep = <T>(value: T): Decided<T> => ({ value, outcome: NOTHING })
const sortedLower = (xs: readonly string[]) => [...xs].map((x) => x.toLowerCase()).sort()
const nameKey = (s: string) => s.trim().toLowerCase()

function read(key: string, v: unknown): Field {
  if (Array.isArray(v)) {
    const comparable = key === 'surges'
      ? (v as Array<{ w: number | null; seconds: number | null }>).map((l) => [l.w, l.seconds])
      : sortedLower(v as string[])
    return { comparable, isStated: v.length > 0, source: (v[0] as { source?: string } | undefined)?.source ?? null }
  }
  const s = v as { value: unknown; source: string | null }
  return { comparable: s.value, isStated: s.value !== null, source: s.source }
}

/** One field: keep the stored value, fill a stored null, replace it, or keep it and record a conflict. */
function decide<T>(field: string, stored: T, incoming: T, a: Field, b: Field, ctx: Ctx): Decided<T> {
  if (!b.isStated) return keep(stored)
  if (!a.isStated) return { value: incoming, outcome: { ...NOTHING, fills: [field] } }
  if (stable(a.comparable) === stable(b.comparable)) return keep(stored)
  if (ctx.replace) return { value: incoming, outcome: { ...NOTHING, replaced: [field] } }
  return {
    value: stored,
    outcome: {
      ...NOTHING,
      conflicts: [{ field, stored: a.comparable, found: b.comparable }],
      found: [{ field, found: b.comparable, source: b.source, seenAt: ctx.now }],
    },
  }
}

function mergeSpecs(stored: Record<string, unknown>, incoming: Record<string, unknown>, ctx: Ctx): Decided<Record<string, unknown>> {
  const decided = Object.keys(incoming).map((key) =>
    [key, decide(`specs.${key}`, stored[key], incoming[key], read(key, stored[key]), read(key, incoming[key]), ctx)] as const)
  return { value: Object.fromEntries(decided.map(([k, d]) => [k, d.value])), outcome: decided.map(([, d]) => d.outcome).reduce(combine, NOTHING) }
}

const extraField = (l: ExtraSpec | undefined): Field => ({ comparable: l?.value.trim() ?? null, isStated: l !== undefined, source: l?.source ?? null })

/** Extra lines by name (case-insensitive): known names decide like specs, new names are fills, never more than 8. */
function mergeExtras(stored: readonly ExtraSpec[], incoming: readonly ExtraSpec[], ctx: Ctx): Decided<ExtraSpec[]> {
  const known = stored.map((line) => {
    const other = incoming.find((l) => nameKey(l.name) === nameKey(line.name))
    return decide(`extraSpecs.${line.name}`, line, other ?? line, extraField(line), extraField(other), ctx)
  })
  const added = incoming
    .filter((l) => !stored.some((s) => nameKey(s.name) === nameKey(l.name)))
    .slice(0, Math.max(0, MAX_EXTRA_SPECS - stored.length))
  const addedOutcome: Outcome = { ...NOTHING, fills: added.map((l) => `extraSpecs.${l.name}`) }
  return { value: [...known.map((d) => d.value), ...added], outcome: [...known.map((d) => d.outcome), addedOutcome].reduce(combine, NOTHING) }
}

/** The row's conflicts after this write: settled fields leave, new readings join once per field and value. */
function nextConflicts(stored: readonly ProductConflict[], o: Outcome): ProductConflict[] {
  const settled = new Set([...o.fills, ...o.replaced])
  const kept = stored.filter((c) => !settled.has(c.field))
  const isKnown = (c: ProductConflict) => kept.some((k) => k.field === c.field && stable(k.found) === stable(c.found))
  return [...kept, ...o.found.filter((c) => !isKnown(c))]
}

function statusOf(o: Outcome): ChangeStatus {
  if (o.fills.length > 0 || o.replaced.length > 0) return 'updated'
  return o.conflicts.length > 0 ? 'conflicts' : 'unchanged'
}

export function mergeProduct(stored: ProductRecord | null, incoming: ProductInput, ctx: Ctx): MergeResult {
  const key = productKey(incoming)
  if (stored === null) {
    const change: ProductChange = { key, kind: incoming.kind, brand: incoming.brand, model: incoming.model, status: 'new', fills: [], replaced: [], conflicts: [] }
    return { change, next: incoming, conflicts: [] }
  }
  const url = (u: string | null): Field => ({ comparable: u, isStated: u !== null, source: u })
  const specs = mergeSpecs(stored.specs as Record<string, unknown>, incoming.specs as Record<string, unknown>, ctx)
  const makerUrl: Decided<string | null> = stored.makerUrl === null && incoming.makerUrl !== null
    ? { value: incoming.makerUrl, outcome: { ...NOTHING, fills: ['makerUrl'] } }
    : keep(stored.makerUrl)
  const datasheetUrl = decide('datasheetUrl', stored.datasheetUrl, incoming.datasheetUrl, url(stored.datasheetUrl), url(incoming.datasheetUrl), ctx)
  const extraSpecs = mergeExtras(stored.extraSpecs, incoming.extraSpecs, ctx)
  // Price is dated and secondary: a different one simply takes the old one's place.
  const price: Decided<ProductInput['price']> = incoming.price !== null && stable(incoming.price) !== stable(stored.price)
    ? { value: incoming.price, outcome: { ...NOTHING, fills: ['price'] } }
    : keep(stored.price)
  const outcome = [specs, makerUrl, datasheetUrl, extraSpecs, price].map((d) => d.outcome).reduce(combine, NOTHING)
  const next = {
    kind: stored.kind, brand: stored.brand, model: stored.model, makerUrl: makerUrl.value, datasheetUrl: datasheetUrl.value,
    extraSpecs: extraSpecs.value, price: price.value, specs: specs.value,
  } as ProductInput
  const change: ProductChange = {
    key, kind: stored.kind, brand: stored.brand, model: stored.model, status: statusOf(outcome),
    fills: outcome.fills, replaced: outcome.replaced, conflicts: outcome.conflicts,
  }
  return { change, next, conflicts: nextConflicts(stored.conflicts, outcome) }
}
```

**Step 4:** run, expect PASS. Then `npm run test:coverage`: product files ≥ 80% on every measure.

**Step 5:** commit `feat: merge rules for products (fill, keep, conflict, replace)`.

---

### Task 5: The `products` table

**Files:**
- Modify: `src/db/schema.ts` (after `appliances`)
- Create: `drizzle/0014_products.sql` (generated) and its snapshot under `drizzle/meta/`

**Step 1:** add to `src/db/schema.ts`; import `uuid` is already imported, add the types from `../lib/product-schema`:

```ts
const productKindList = sql.raw(PRODUCT_KINDS.map((k) => `'${k}'`).join(', '))
const productOriginList = sql.raw(PRODUCT_ORIGINS.map((o) => `'${o}'`).join(', '))

/** The product library: inverters and batteries as their datasheets state them. Zod-checked on read (product-repo). */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    /** productKey(): kind, the brand's first word and the model, normalised. */
    key: text('key').notNull().unique(),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    makerUrl: text('maker_url'),
    datasheetUrl: text('datasheet_url').notNull(),
    specs: jsonb('specs').$type<InverterSpecs | BatterySpecs>().notNull(),
    extraSpecs: jsonb('extra_specs').$type<ExtraSpec[]>().notNull().default([]),
    price: jsonb('price').$type<ProductInput['price']>(),
    origin: text('origin').notNull(),
    conflicts: jsonb('conflicts').$type<ProductConflict[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    check('products_kind_check', sql`${t.kind} in (${productKindList})`),
    check('products_origin_check', sql`${t.origin} in (${productOriginList})`),
  ],
)
```

**Step 2:** generate the migration. drizzle-kit only diffs the schema here; it does not connect:

```bash
npx drizzle-kit generate --name products
```

Expected: `drizzle/0014_products.sql` with one `CREATE TABLE "products"`, the unique constraint on `key` and both checks. Read it; nothing else may change.

**Step 3:** `npm run typecheck`. Expected: PASS.

**Step 4:** commit `feat: products table`.

---

### Task 6: Migrate the e2e database safely

**Files:**
- Create: `scripts/migrate-test-db.ts`

**Step 1:**

```ts
// Applies drizzle/ migrations to the e2e database only. `npm run db:migrate` reads .env.local, which points at
// production; this reads .env.test.local through e2e's guard, which throws for production or for .env.local's database.
//
//   npx tsx scripts/migrate-test-db.ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'
import { endpointOf, loadTestEnv } from '../e2e/test-env'

loadTestEnv()
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set after loadTestEnv()')
await migrate(drizzle({ client: neon(url) }), { migrationsFolder: './drizzle' })
console.log(`migrated ${endpointOf(url)}`)
```

**Step 2:** run `npx tsx scripts/migrate-test-db.ts`. Expected: `migrated ep-crimson-rain-au38702t` (the e2e branch). Any other endpoint, or an error from the guard: stop.

**Step 3:** commit `chore: a guarded migrate for the e2e database`.

---

### Task 7: Repo and route, driven by an e2e test

**Files:**
- Create: `e2e/catalog-products.spec.ts`
- Modify: `e2e/db.ts` (add `deleteTestProduct`)
- Create: `src/server/product-repo.ts`
- Create: `src/routes/api/catalog/products.ts`
- Regenerated: `src/routeTree.gen.ts`

**Step 1: the failing e2e test** (`e2e/catalog-products.spec.ts`):

```ts
import { expect, test, type APIRequestContext } from '@playwright/test'
import { catalogAuthHeader as auth } from './catalog-token'
import { deleteTestProduct } from './db'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'API checks run once')
})

const SHEET = 'https://example.com/e2e-datasheet.pdf'
const NONE = { value: null, source: null, asWritten: null }
const stated = (value: number, asWritten: string) => ({ value, source: SHEET, asWritten })

function inverter(model: string, continuousW = 6000) {
  return {
    kind: 'inverter', brand: 'E2E Power', model, makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      continuousW: stated(continuousW, `Rated power ${continuousW}W`),
      surges: [{ w: 12000, seconds: 3.5, asWritten: '12,000W for ≈3.5 seconds', source: SHEET }],
      batteryVolts: stated(48, '48 VDC'), splitPhase: NONE, chargerA: NONE, pvInputW: NONE, pvVocMax: NONE,
      maxParallelUnits: NONE, idleW: NONE, peakEfficiencyPct: NONE, warrantyYears: NONE, bmsComms: ['can'], compatibleBatteryBrands: [],
    },
  }
}

const post = (request: APIRequestContext, query: string, data: unknown) => request.post(`/api/catalog/products${query}`, { headers: auth, data })
const stored = async (request: APIRequestContext, key: string) =>
  ((await (await request.get('/api/catalog/products', { headers: auth })).json()).items as Array<{ key: string }>).find((i) => i.key === key)

test('the products API needs the token', async ({ request }) => {
  expect((await request.get('/api/catalog/products')).status()).toBe(401)
})

test('dry run, create, keep a conflicting reading aside, then replace it', async ({ request }) => {
  const model = `X${Date.now()}`
  let key = ''
  try {
    const dry = await post(request, '?dryRun=true', [inverter(model)])
    expect(dry.status()).toBe(200)
    const { changes } = await dry.json()
    expect(changes).toEqual([expect.objectContaining({ status: 'new', brand: 'E2E Power', model })])
    key = changes[0].key

    const base = inverter(model)
    const unsourced = { ...base, specs: { ...base.specs, continuousW: { value: 6000, source: null, asWritten: null } } }
    expect((await post(request, '', [unsourced])).status()).toBe(422)

    expect(await (await post(request, '', [inverter(model)])).json()).toEqual({ created: [key], updated: [], unchanged: [], conflicts: [] })
    expect(await stored(request, key)).toMatchObject({ origin: 'admin', specs: { continuousW: { value: 6000 } }, conflicts: [] })

    const conflict = await post(request, '', [inverter(model, 5000)])
    expect(await conflict.json()).toEqual({ created: [], updated: [], unchanged: [], conflicts: [{ key, fields: ['specs.continuousW'] }] })
    expect(await stored(request, key)).toMatchObject({ specs: { continuousW: { value: 6000 } }, conflicts: [{ field: 'specs.continuousW', found: 5000 }] })

    const replaced = await post(request, '?replace=true', [inverter(model, 5000)])
    expect(await replaced.json()).toEqual({ created: [], updated: [key], unchanged: [], conflicts: [] })
    expect(await stored(request, key)).toMatchObject({ specs: { continuousW: { value: 5000 } }, conflicts: [] })
  } finally {
    // Runs even when an assertion fails midway, so no run leaves its row behind.
    if (key) await deleteTestProduct(key)
  }
})
```

Add to `e2e/db.ts`:

```ts
/** Deletes a product a test created. Only keys of the "E2E …" brand, so a wrong key never removes a real product. */
export async function deleteTestProduct(key: string): Promise<void> {
  if (!/^(inverter|battery):e2e:/.test(key)) throw new Error(`refusing to delete "${key}": not an e2e product key`)
  await testDb()`delete from products where key = ${key}`
}
```

**Step 2:** `npx playwright test e2e/catalog-products.spec.ts --project=desktop`. Expected: FAIL (404 on the route).

**Step 3: the repo** (`src/server/product-repo.ts`):

```ts
import { asc, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { products } from '../db/schema'
import { mergeProduct, type MergeResult, type ProductChange } from '../lib/product-merge'
import { ProductConflictSchema, ProductInputSchema, productKey, type ProductInput, type ProductOrigin, type ProductRecord } from '../lib/product-schema'

type Row = typeof products.$inferSelect
const Conflicts = z.array(ProductConflictSchema)

/** A row that no longer passes the schema (edited by hand) is skipped and logged, not served. */
function toRecord(row: Row): ProductRecord | null {
  const product = ProductInputSchema.safeParse({
    kind: row.kind, brand: row.brand, model: row.model, makerUrl: row.makerUrl, datasheetUrl: row.datasheetUrl,
    specs: row.specs, extraSpecs: row.extraSpecs, price: row.price,
  })
  const conflicts = Conflicts.safeParse(row.conflicts)
  if (!product.success || !conflicts.success) {
    console.error('[products] skipping invalid product row', { key: row.key, issues: product.error?.issues ?? conflicts.error?.issues })
    return null
  }
  return { ...product.data, id: row.id, key: row.key, origin: row.origin as ProductOrigin, conflicts: conflicts.data, retired: row.retiredAt !== null }
}

const isRecord = (r: ProductRecord | null): r is ProductRecord => r !== null

export async function listProducts(): Promise<ProductRecord[]> {
  const rows = await db.select().from(products).orderBy(asc(products.kind), asc(products.brand), asc(products.model))
  return rows.map(toRecord).filter(isRecord)
}

async function plan(items: readonly ProductInput[], replace: boolean): Promise<MergeResult[]> {
  const rows = await db.select().from(products).where(inArray(products.key, items.map(productKey)))
  const byKey = new Map(rows.map(toRecord).filter(isRecord).map((r) => [r.key, r]))
  const now = new Date().toISOString()
  return items.map((item) => mergeProduct(byKey.get(productKey(item)) ?? null, item, { replace, now }))
}

export async function previewProducts(items: readonly ProductInput[], replace: boolean): Promise<ProductChange[]> {
  return (await plan(items, replace)).map((m) => m.change)
}

export interface UpsertSummary { created: string[]; updated: string[]; unchanged: string[]; conflicts: Array<{ key: string; fields: string[] }> }

/** The only way products are written. Unchanged products are skipped; one statement, so it is all or nothing. */
export async function upsertProducts(items: readonly ProductInput[], opts: { replace: boolean; actor: string }): Promise<UpsertSummary> {
  const merged = await plan(items, opts.replace)
  const toWrite = merged.filter((m) => m.change.status !== 'unchanged')
  if (toWrite.length > 0) {
    await db
      .insert(products)
      .values(toWrite.map(({ change, next, conflicts }) => ({
        kind: next.kind, key: change.key, brand: next.brand, model: next.model, makerUrl: next.makerUrl, datasheetUrl: next.datasheetUrl,
        specs: next.specs, extraSpecs: next.extraSpecs, price: next.price, origin: 'admin', conflicts, updatedBy: opts.actor,
      })))
      .onConflictDoUpdate({
        target: products.key,
        set: {
          makerUrl: sql`excluded.maker_url`, datasheetUrl: sql`excluded.datasheet_url`, specs: sql`excluded.specs`,
          extraSpecs: sql`excluded.extra_specs`, price: sql`excluded.price`, conflicts: sql`excluded.conflicts`,
          updatedAt: sql`now()`, lastSeenAt: sql`now()`, updatedBy: sql`excluded.updated_by`,
        },
      })
  }
  const keysWith = (status: ProductChange['status']) => merged.filter((m) => m.change.status === status).map((m) => m.change.key)
  return {
    created: keysWith('new'),
    updated: keysWith('updated'),
    unchanged: keysWith('unchanged'),
    conflicts: merged.filter((m) => m.change.status === 'conflicts').map((m) => ({ key: m.change.key, fields: m.change.conflicts.map((c) => c.field) })),
  }
}
```

**Step 4: the route** (`src/routes/api/catalog/products.ts`):

```ts
import { createFileRoute } from '@tanstack/react-router'
import { parseProducts, productKey } from '../../../lib/product-schema'
import { API_ACTOR, authorize, json } from '../../../server/catalog-api'
import { listProducts, previewProducts, upsertProducts } from '../../../server/product-repo'

/** The product library, for the /research-product skill. Same token, throttle and envelope as the appliance API. */
export const Route = createFileRoute('/api/catalog/products')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        try {
          return json({ items: await listProducts() })
        } catch (error) {
          console.error('[catalog-api] reading the products failed', { error })
          return json({ error: 'Could not read the products' }, 500)
        }
      },
      POST: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        const parsed = parseProducts(await request.json().catch(() => undefined))
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        const params = new URL(request.url).searchParams
        const replace = params.get('replace') === 'true'
        const keys = parsed.items.map(productKey)
        if (params.get('dryRun') === 'true') {
          try {
            return json({ changes: await previewProducts(parsed.items, replace) })
          } catch (error) {
            console.error('[catalog-api] product dry run failed', { keys, error })
            return json({ error: 'Could not read the products' }, 500)
          }
        }
        try {
          return json(await upsertProducts(parsed.items, { replace, actor: API_ACTOR }))
        } catch (error) {
          console.error('[catalog-api] product upsert failed', { keys, error })
          return json({ error: 'Could not save; nothing was written' }, 500)
        }
      },
    },
  },
})
```

**Step 5:** `npm run build` (regenerates `src/routeTree.gen.ts`), then `npm run typecheck`. Expected: both PASS.

**Step 6:** `npx playwright test e2e/catalog-products.spec.ts e2e/catalog-api.spec.ts --project=desktop`. Expected: PASS, and the appliance API still passes.

**Step 7:** commit `feat: token API for the product library`.

---

### Task 8: The `/research-product` skill

**Files:**
- Create: `.claude/skills/research-product/SKILL.md`

**Step 1:** write the skill:

````markdown
---
name: research-product
description: Research inverters or batteries from their makers' datasheets and add or update them in the solar-dimension product library through the token-protected API after the user confirms. Use for "/research-product <models | a need | --from file>" or "add <inverter or battery> to the product library".
---

# Research products into the library

Arguments: `<what> [--target local|prod] [--replace]` (default target `local`).

`<what>` is one of:
- **Named models**, e.g. `EG4 6000XP, Pytes V5`: research exactly these.
- **A need**, e.g. `48 V inverter, ≥ 6 kW, split-phase`: search for current models that meet it, pick up to 4 whose maker publishes a datasheet, show the list, then research each.
- **`--from <file.json>`**: a saved search run. Take its products from the JSON's `inverters` and `batteries`, or, in a spike `--out` file, from the `output_text` of its `message` item. Research each one again from its datasheet; the run's values are leads, not answers.

## Setup
- Read `CATALOG_API_TOKEN` from `.env.local`. Base URL: `http://localhost:3000` for local; for prod, `CATALOG_API_URL` from `.env.local`.
- Never print, echo or log the token or any database URL. Pass the token only in the `Authorization: Bearer` header.
- Before any write, follow "Which database a target writes to" in `.claude/skills/research-appliance/SKILL.md`. `--target local` is a production write unless the local server runs on another Neon branch.

## Steps
1. **List the products** to research (see `<what>`).
2. **Find each one's datasheet** on the maker's site. Fetch it. A PDF fetch saves the file and reports its path: `Read` that path with `pages` and read the spec table itself. Take no number from a summary, a reseller page when the datasheet states it, or a similar model. No datasheet found: drop the product and say so.
3. **Fill one item per product** (shape below). Every spec is `{ value, source, asWritten }`:
   - `value`: the number, in W, V, A, s, Ah, kWh, % or years. `source`: the https URL you read it on. `asWritten`: the datasheet's own words for it, copied.
   - Not stated: all three `null`. Never estimate, convert from a similar model or fill a typical value.
   - `surges`: every surge or overload level, shortest first, each `{ w, seconds, asWritten, source }`. "12,000W for ≈3.5 s | 11,000W for ≈5 s" is two levels. "2× Pn, 5 s" gets `w` = 2 × the stated rated power. A level given only in VA gets `w: null`.
   - Battery `nominalV` as written (51.2), not the system class (48). `chemistry` is `lifepo4`, `agm` or `other`.
   - `bmsComms`: the protocols the datasheet names (`can`, `rs485`). Compatible brands: only those the maker lists.
   - `extraSpecs`: up to 8 more lines an installer would check, as written: transfer time, IP rating, operating temperature, dimensions, weight, the maker's depth of discharge.
   - `price`: only if you saw it on a seller's page; `seenOn` is today. Never search for prices.
4. **Check for duplicates:** `curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/catalog/products`. If the product is there under another spelling, use the stored `brand` and `model` exactly.
5. **Dry run:** `POST $BASE/api/catalog/products?dryRun=true` (add `&replace=true` with `--replace`) with a JSON array of items. Each change has `status` (`new`, `updated`, `conflicts`, `unchanged`), `fills`, `replaced` and `conflicts` (`field`, `stored`, `found`).
6. **Show the user** one table per product: its status and key, then every stated spec with value, `asWritten` and the source's host, then fills and conflicts (stored → found). Flag: a VA-only or duration-less surge, no parallel limit, any stated value missing `asWritten`. Say "this writes to PRODUCTION" when it does.
7. **Wait for an explicit yes.** Then `POST` the same body to the same path without `dryRun` and report `created`, `updated`, `unchanged` and `conflicts`. Conflicts are kept on the product for review; `--replace` overwrites them.
8. **On errors:** 422 → show the per-item issues (index and dotted path), fix, repeat from step 5. 401 → the token is wrong or missing in `.env.local`. 404 → the API is disabled on that target (`CATALOG_API_TOKEN` unset there). 429 → too many failed requests from this IP; wait. 500 → database error; report it and ask the user to retry.

## Item shape

Inverter:
```json
{ "kind": "inverter", "brand": "EG4 Electronics", "model": "6000XP",
  "makerUrl": "https://…", "datasheetUrl": "https://….pdf", "price": null,
  "extraSpecs": [{ "name": "Transfer time", "value": "<15ms @ Single / <30ms @ Parallel", "source": "https://….pdf" }],
  "specs": {
    "continuousW": { "value": 6000, "source": "https://….pdf", "asWritten": "NOMINAL POWER OUTPUT 6000W" },
    "surges": [{ "w": 12000, "seconds": 3.5, "asWritten": "12,000W for ≈3.5 seconds", "source": "https://….pdf" }],
    "batteryVolts": {…}, "splitPhase": {…}, "chargerA": {…}, "pvInputW": {…}, "pvVocMax": {…},
    "maxParallelUnits": {…}, "idleW": {…}, "peakEfficiencyPct": {…}, "warrantyYears": {…},
    "bmsComms": ["can", "rs485"], "compatibleBatteryBrands": [] } }
```

Battery: the same top level with `"kind": "battery"` and
```json
"specs": { "chemistry": {…}, "nominalV": {…}, "ah": {…}, "kWh": {…}, "maxContinuousA": {…}, "peakA": {…},
  "peakSeconds": {…}, "maxParallel": {…}, "cycleLife": {…}, "warrantyYears": {…},
  "bmsComms": [], "compatibleInverterBrands": [] }
```
Every `{…}` is `{ "value", "source", "asWritten" }`. All keys are required; unknown keys are refused.
````

**Step 2:** commit `feat: /research-product skill`.

---

### Task 9: Trial the skill on the e2e branch

The skill's first real run writes to the e2e Neon branch, never production.

**Step 1:** start the built app on the e2e database with the token the skill reads. Sourcing `.env.test.local` exports its `DATABASE_URL`, and `node --env-file` never overrides a variable that is already set:

```bash
set -a && . ./.env.test.local && set +a && npm run start
```

Run it in the background. Check the endpoint the skill will report (step "Which database…"): it must be `ep-crimson-rain-au38702t`.

**Step 2:** run `/research-product EG4 6000XP --target local`. Check the dry-run table against the datasheet read on 2026-10-09: 6000 W; surges 12,000 W / 3.5 s and 11,000 W / 5 s; 48 V; split-phase; 125 A charger; 16 in parallel; CAN and RS485; 5-year warranty. Show the table to the user, and write only on their yes.

**Step 3:** re-run the same command. Expected dry run: `unchanged`.

**Step 4:** delete the trial row from the e2e branch with a guarded one-off (the key from step 2). Then stop the server.

---

### Task 10: Verify and review

**Step 1:** `npm run typecheck && npm run test:coverage`. Expected: PASS, coverage thresholds met.

**Step 2:** `npx playwright test e2e/catalog-products.spec.ts e2e/catalog-api.spec.ts --project=desktop`. Expected: PASS.

**Step 3:** code review of the branch since `90df461` (code-reviewer agent). Fix CRITICAL and HIGH findings.

**Step 4:** in the spec, mark slice 1 done and list anything that changed from it.

Out of this slice: the in-app search, fit and its UI, retire/restore for products, and an admin page.
