# Product library, slice 2: the fit check, loading the library, the card and the spec sheet

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task by task.

Spec: `docs/superpowers/specs/2026-10-09-product-library-design.md` (sections "Fit" and "UI").
Design: variant **A · Shortlist card** on https://claude.ai/artifact/GfJzLYhcZQKrekiKrJ8nJM (artboards A1 to A4). A's spec sheet ends with the "Next" button borrowed from B.
Depends on slice 1 (`docs/superpowers/plans/2026-10-09-product-library-slice-1.md`): `src/lib/product-schema.ts`, the `products` table and `src/server/product-repo.ts` must exist.

**Goal:** on the kit step, show up to 4 inverters and 4 batteries from the product library that fit the project's kit, and open a spec sheet for each that puts every datasheet value beside what the kit needs.

**Architecture:** the fit check is pure code in `src/lib/product-fit.ts`, ported from the spike's `scripts/product-search/grade.ts`: it turns a `SizingResult` into needs, grades each product check as `ok`, `fails` or `unclear`, sizes a battery bank, and ranks. Words live in `src/lib/product-text.ts` and a `products` dictionary, the way `quote-items.ts` and `quote-text.ts` split numbers from words. The library loads once in the root loader beside the appliance catalog, so moving between steps still makes no server call. The card and the sheet are dumb components fed with ready text.

**Tech stack:** TypeScript, Zod 4.6, TanStack Start (root loader, `createServerFn`), react-aria-components (dialog), lucide-react, Vitest, Playwright.

**Out of this slice:** the in-app "Find more" search and its states (canvas S1, S2), the compare table (B), the parts-list hint (C), pairing an inverter with a battery, and using a product in the kit.

**Safety, read before any database or server step:**
- `.env.local` points at the **production** database. Never run `npm run db:migrate`, `npm run dev` or `npm run start` by hand. Only Playwright starts servers (it loads the guarded test env).
- To look at the app in a browser on the e2e database, start the built server with Node's own env loading: `node --env-file-if-exists=.env.local --env-file=.env.test.local .output/server/index.mjs` (the `built-on-e2e-db` config in `.claude/launch.json`). Never source `.env.test.local` in a shell: the URL's `&` ends the assignment, `DATABASE_URL` stays unset and the server falls back to production. Confirm with `GET /api/catalog/products` answering 200 before trusting it (production has no `products` table until slice 1 deploys).
- Never print a database URL or a token.

Each task runs test-first: write the test, run it red, implement, run it green, commit.

---

### Task 0: Preconditions

**Step 1:** `ls -la .env.local .env.test.local` shows both symlinks (else `ln -s ../../../.env.test.local .env.test.local && ln -s ../../../.env.local .env.local`).

**Step 2:** `npm test`. Expected: all pass (841 at the end of slice 1).

**Step 3:** `rg -n "export (type|function) (ProductRecord|productKey)" src/lib/product-schema.ts` finds both. If not, slice 1 is missing: stop.

---

### Task 1: Needs and the inverter checks

**Files:**
- Create: `src/lib/product-fit.ts`
- Test: `src/lib/product-fit.test.ts`
- Modify: `src/lib/product-schema.ts` (add `PublicProduct`)

**Step 1:** add to `src/lib/product-schema.ts`, after `ProductRecord`:

```ts
/** A product as the app shows it: no admin fields (conflicts, origin, id). */
export type PublicProduct = ProductInput & { key: string }

export function toPublicProduct(r: ProductRecord): PublicProduct {
  const { id: _id, origin: _origin, conflicts: _conflicts, retired: _retired, ...product } = r
  return product
}
```

**Step 2: failing tests.** First add the kit's needs to `src/lib/product-fixtures.ts`, so the fit and text tests share them:

```ts
import type { ProductNeeds } from './product-fit'

/** What the spike's kit asks for: the default loads plus a 1-ton inverter AC and a washer, 10 h at 48 V LiFePO₄. */
export const NEEDS: ProductNeeds = {
  runningW: 2065, inverterW: 2582, surgeW: 3115, surgeSeconds: 3, volts: 48, chemistry: 'lifepo4',
  usableWh: 13084, dcA: 48, splitPhase: false, arrayW: null,
}
```

Then `src/lib/product-fit.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { inverterChecks, overall, productNeeds, surgeRating, type ProductNeeds } from './product-fit'
import { inverter, NEEDS, NONE, SHEET, stated } from './product-fixtures'
import { compute } from './sizing'
import { DEFAULT_QTY } from './store'

/** The same kit, sized by the real engine, so NEEDS cannot drift from it unnoticed. */
const KIT = compute({ qty: { ...DEFAULT_QTY, ac1i: 1, washer: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
const grades = (specs: Parameters<typeof inverterChecks>[0], n: ProductNeeds = NEEDS) =>
  Object.fromEntries(inverterChecks(specs, n).map((c) => [c.id, c.reason ? `${c.grade}:${c.reason}` : c.grade]))

describe('productNeeds', () => {
  test('reads what a product must meet from the sized kit', () => {
    expect(productNeeds(KIT)).toEqual(NEEDS)
  })
})

describe('surgeRating', () => {
  const levels = inverter().specs.surges
  test('takes the highest level that lasts as long as the start-up', () => {
    expect(surgeRating(levels, 6000, 3)?.w).toBe(12000)
    expect(surgeRating(levels, 6000, 4)?.w).toBe(11000)
  })
  test('falls back to the continuous rating when no level lasts long enough', () => {
    expect(surgeRating(levels, 6000, 10)).toEqual({ w: 6000, level: null })
  })
  test('is null when no level states both watts and seconds', () => {
    expect(surgeRating([{ w: null, seconds: 10, asWritten: '24,000VA', source: SHEET }], 12000, 3)).toBeNull()
  })
})

describe('inverterChecks', () => {
  test('the EG4 6000XP fits the kit', () => {
    const checks = inverterChecks(inverter().specs, NEEDS)
    expect(checks.map((c) => c.id)).toEqual(['continuous', 'surge', 'batteryVolts'])
    expect(overall(checks)).toBe('ok')
  })
  test('too little continuous power fails; headroom is part of the need', () => {
    expect(grades(inverter({ continuousW: stated(2500, '2500W') }).specs).continuous).toBe('fails')
    expect(grades(inverter({ continuousW: stated(2582, '2582W') }).specs).continuous).toBe('ok')
  })
  test('a surge that never reaches the start-up fails', () => {
    const weak = [{ w: 3000, seconds: 5, asWritten: '3000W 5 s', source: SHEET }]
    expect(grades(inverter({ surges: weak }).specs).surge).toBe('fails')
  })
  test('a surge the datasheet does not pin down is unclear, with the reason', () => {
    const va = [{ w: null, seconds: 10, asWritten: '24,000VA for 10 s', source: SHEET }]
    const noTime = [{ w: 24000, seconds: null, asWritten: 'Max. Peak Power 24000W', source: SHEET }]
    expect(grades(inverter({ surges: va }).specs).surge).toBe('unclear:surgeInVa')
    expect(grades(inverter({ surges: noTime }).specs).surge).toBe('unclear:surgeNoDuration')
    expect(grades(inverter({ surges: [] }).specs).surge).toBe('unclear:notStated')
  })
  test('the wrong battery voltage fails; an unstated one is unclear', () => {
    expect(grades(inverter({ batteryVolts: stated(24, '24 VDC') }).specs).batteryVolts).toBe('fails')
    expect(grades(inverter({ batteryVolts: NONE }).specs).batteryVolts).toBe('unclear:notStated')
  })
  test('split-phase and solar input are checked only when the kit needs them', () => {
    const needsMore = { ...NEEDS, splitPhase: true, arrayW: 9000 }
    expect(grades(inverter().specs, needsMore)).toMatchObject({ splitPhase: 'ok', solarInput: 'unclear:notStated' })
    expect(grades(inverter({ splitPhase: stated(false, '230VAC'), pvInputW: stated(8000, '8000W') }).specs, needsMore))
      .toMatchObject({ splitPhase: 'fails', solarInput: 'fails' })
  })
})
```

**Step 3:** `npx vitest run src/lib/product-fit.test.ts`. Expected: FAIL (module not found).

**Step 4: implement** `src/lib/product-fit.ts`:

```ts
import { SIZING, type ChemistryId, type Voltage } from './catalog'
import type { InverterSpecs, SurgeLevel } from './product-schema'
import { hasPanels, type SizingResult } from './sizing'

/** What a product must meet, read from the engine's result. */
export interface ProductNeeds {
  runningW: number
  /** The engine's own minimum: running load × SIZING.HEADROOM. */
  inverterW: number
  surgeW: number
  surgeSeconds: number
  volts: Voltage
  chemistry: ChemistryId
  /** Energy the bank must deliver over the window, at the battery terminals. */
  usableWh: number
  /** DC current the bank must supply at the full running load. */
  dcA: number
  splitPhase: boolean
  /** Solar array the inverter's charger must accept; null for a battery-only kit. */
  arrayW: number | null
}

export function productNeeds(r: SizingResult): ProductNeeds {
  return {
    runningW: r.runningW,
    inverterW: Math.ceil(r.runningW * SIZING.HEADROOM),
    surgeW: r.surgeW,
    surgeSeconds: r.surgeSeconds,
    volts: r.volts,
    chemistry: r.chemistry,
    usableWh: Math.ceil(r.loadWh / SIZING.INVERTER_EFF),
    dcA: Math.ceil(r.runningW / SIZING.INVERTER_EFF / r.volts),
    splitPhase: r.warnings.some((w) => w.code === 'splitPhase'),
    arrayW: hasPanels(r) ? r.solar.arrayW : null,
  }
}

/** ok = meets the kit · fails = stated and too small or wrong · unclear = the datasheet does not say */
export type FitGrade = 'ok' | 'fails' | 'unclear'
export type FitCheckId =
  | 'continuous' | 'surge' | 'batteryVolts' | 'splitPhase' | 'solarInput'
  | 'chemistry' | 'unitVolts' | 'energy' | 'discharge' | 'parallel'
/** Why a check is unclear: the value is missing, or the surge is given only in VA or without a duration. */
export type UnclearReason = 'notStated' | 'surgeInVa' | 'surgeNoDuration'
export interface FitCheck { id: FitCheckId; grade: FitGrade; reason: UnclearReason | null }

export const check = (id: FitCheckId, grade: FitGrade, reason: UnclearReason | null = null): FitCheck => ({ id, grade, reason })
export const unclear = (id: FitCheckId, reason: UnclearReason = 'notStated'): FitCheck => check(id, 'unclear', reason)
const atLeast = (id: FitCheckId, value: number | null, need: number): FitCheck =>
  value === null ? unclear(id) : check(id, value >= need ? 'ok' : 'fails')

/** The worst grade wins: one failed check fails the product, one unknown leaves it unclear. */
export function overall(checks: readonly FitCheck[]): FitGrade {
  if (checks.some((c) => c.grade === 'fails')) return 'fails'
  return checks.some((c) => c.grade === 'unclear') ? 'unclear' : 'ok'
}

export type KnownLevel = SurgeLevel & { w: number; seconds: number }
const isKnown = (l: SurgeLevel): l is KnownLevel => l.w !== null && l.seconds !== null

/**
 * The watts an inverter holds for a start-up lasting `seconds`, read as the engine's surgeRatedFor does: the highest
 * level that lasts at least that long, else the continuous rating. Null when no level states both watts and seconds,
 * or when it comes down to a continuous rating the datasheet does not state.
 */
export function surgeRating(levels: readonly SurgeLevel[], continuousW: number | null, seconds: number): { w: number; level: KnownLevel | null } | null {
  const known = levels.filter(isKnown)
  if (known.length === 0) return null
  const lasting = known.filter((l) => l.seconds >= seconds)
  if (lasting.length === 0) return continuousW === null ? null : { w: continuousW, level: null }
  const best = lasting.reduce((a, l) => (l.w > a.w ? l : a))
  return { w: best.w, level: best }
}

function surgeCheck(s: InverterSpecs, n: ProductNeeds): FitCheck {
  if (!s.surges.some(isKnown)) {
    if (s.surges.some((l) => l.w === null)) return unclear('surge', 'surgeInVa')
    return unclear('surge', s.surges.length > 0 ? 'surgeNoDuration' : 'notStated')
  }
  const rated = surgeRating(s.surges, s.continuousW.value, n.surgeSeconds)
  return rated === null ? unclear('surge') : check('surge', rated.w >= n.surgeW ? 'ok' : 'fails')
}

export function inverterChecks(s: InverterSpecs, n: ProductNeeds): FitCheck[] {
  const volts = s.batteryVolts.value
  const split = s.splitPhase.value
  return [
    atLeast('continuous', s.continuousW.value, n.inverterW),
    surgeCheck(s, n),
    volts === null ? unclear('batteryVolts') : check('batteryVolts', volts === n.volts ? 'ok' : 'fails'),
    ...(n.splitPhase ? [split === null ? unclear('splitPhase') : check('splitPhase', split ? 'ok' : 'fails')] : []),
    ...(n.arrayW !== null ? [atLeast('solarInput', s.pvInputW.value, n.arrayW)] : []),
  ]
}
```

**Step 5:** run, expect PASS. **Step 6:** commit `feat: kit needs and inverter fit checks for library products`.

---

### Task 2: Battery checks and the bank

**Files:** modify `src/lib/product-fit.ts`, `src/lib/product-fit.test.ts`.

**Step 1: failing tests** (append; import `bankFor`, `batteryChecks`, `systemVolts` and `battery` from the fixtures):

```ts
describe('systemVolts', () => {
  test('maps a datasheet voltage to the system it is sold as', () => {
    expect([12.8, 25.6, 51.2, 48, 60].map(systemVolts)).toEqual([12, 24, 48, 48, null])
  })
})

describe('bankFor and batteryChecks', () => {
  const bgrades = (specs: Parameters<typeof batteryChecks>[0], n: ProductNeeds = NEEDS) =>
    Object.fromEntries(batteryChecks(specs, n).checks.map((c) => [c.id, c.grade]))

  test('sizes a Pytes V5 bank for the kit at the app\'s depth of discharge', () => {
    // 5.12 kWh × 85% = 4.352 kWh usable per unit; 13.084 kWh needs 4.
    expect(bankFor(battery().specs, NEEDS)).toEqual({ series: 1, strings: 4, units: 4, bankWh: 20480, usableWh: 17408, bankA: 400 })
    expect(overall(batteryChecks(battery().specs, NEEDS).checks)).toBe('ok')
  })
  test('adds strings when one string cannot carry the current', () => {
    expect(bankFor(battery({ maxContinuousA: stated(10, '10A') }).specs, NEEDS)?.strings).toBe(5)
  })
  test('puts 12.8 V units in series to reach the bank voltage', () => {
    const small = battery({ nominalV: stated(12.8, '12.8V'), kWh: NONE, ah: stated(100, '100Ah') }).specs
    expect(bankFor(small, NEEDS)).toMatchObject({ series: 4, units: 48 })
  })
  test('more strings than the maker allows fails; no stated limit is unclear', () => {
    expect(bgrades(battery({ maxParallel: stated(2, 'Max 2 in parallel') }).specs).parallel).toBe('fails')
    expect(bgrades(battery({ maxParallel: NONE }).specs).parallel).toBe('unclear')
  })
  test('another chemistry or a voltage that cannot build the bank fails', () => {
    expect(bgrades(battery({ chemistry: stated('agm' as const, 'AGM') }).specs).chemistry).toBe('fails')
    expect(bgrades(battery({ nominalV: stated(36, '36V') }).specs).unitVolts).toBe('fails')
  })
  test('unstated capacity or discharge leaves the battery unclear', () => {
    expect(bgrades(battery({ kWh: NONE, ah: NONE }).specs).energy).toBe('unclear')
    expect(bgrades(battery({ maxContinuousA: NONE }).specs).discharge).toBe('unclear')
  })
})
```

**Step 2:** run, expect FAIL.

**Step 3: implement** (append to `product-fit.ts`; add `CHEMISTRIES, VOLTAGES` to the catalog import and `BatterySpecs` to the schema import):

```ts
/** How far a datasheet's nominal voltage may sit from the system voltage it is sold as. */
const SYSTEM_V_TOLERANCE = 0.1
/**
 * The system voltage a unit is sold as. Datasheets give the cell math (16 LiFePO₄ cells × 3.2 V = 51.2 V) for what the
 * market, and this app's catalog, call a 48 V battery; 12.8 V and 25.6 V likewise mean 12 V and 24 V.
 */
export function systemVolts(nominalV: number): Voltage | null {
  return VOLTAGES.find((v) => Math.abs(nominalV - v) / v <= SYSTEM_V_TOLERANCE) ?? null
}

/** Watt-hours of one unit: its kWh, or volts × Ah. */
export function unitWh(s: BatterySpecs): number | null {
  if (s.kWh.value !== null) return s.kWh.value * 1000
  return s.nominalV.value !== null && s.ah.value !== null ? s.nominalV.value * s.ah.value : null
}

/** The bank a unit builds for a kit. `bankA` is null when the maker states no continuous discharge. */
export interface BatteryBank { series: number; strings: number; units: number; bankWh: number; usableWh: number; bankA: number | null }

/**
 * Units in series to reach the bank voltage, strings for the energy and for the current. Usable energy counts the app's
 * depth of discharge for the chemistry, not the maker's, so the count matches the kit sheet's.
 */
export function bankFor(s: BatterySpecs, n: ProductNeeds): BatteryBank | null {
  const sysV = s.nominalV.value === null ? null : systemVolts(s.nominalV.value)
  const wh = unitWh(s)
  if (sysV === null || wh === null || n.volts % sysV !== 0) return null
  const series = n.volts / sysV
  const dod = CHEMISTRIES[n.chemistry].dod
  const amps = s.maxContinuousA.value
  const forEnergy = Math.ceil(n.usableWh / (wh * series * dod))
  const forCurrent = amps === null ? 1 : Math.ceil(n.dcA / amps)
  const strings = Math.max(1, forEnergy, forCurrent)
  const units = series * strings
  return { series, strings, units, bankWh: wh * units, usableWh: wh * units * dod, bankA: amps === null ? null : amps * strings }
}

export function batteryChecks(s: BatterySpecs, n: ProductNeeds): { checks: FitCheck[]; bank: BatteryBank | null } {
  const bank = bankFor(s, n)
  const chem = s.chemistry.value
  const v = s.nominalV.value
  const sysV = v === null ? null : systemVolts(v)
  const maxParallel = s.maxParallel.value
  const checks = [
    chem === null ? unclear('chemistry') : check('chemistry', chem === n.chemistry ? 'ok' : 'fails'),
    v === null ? unclear('unitVolts') : check('unitVolts', sysV !== null && n.volts % sysV === 0 ? 'ok' : 'fails'),
    unitWh(s) === null ? unclear('energy') : check('energy', 'ok'),
    s.maxContinuousA.value === null ? unclear('discharge') : check('discharge', 'ok'),
    maxParallel === null || bank === null ? unclear('parallel') : check('parallel', bank.strings <= maxParallel ? 'ok' : 'fails'),
  ]
  return { checks, bank }
}
```

**Step 4:** run, expect PASS. **Step 5:** commit `feat: battery fit checks and bank sizing for library products`.

---

### Task 3: Match and rank

**Files:** modify `src/lib/product-fit.ts`, `src/lib/product-fit.test.ts`.

Rules (spec, "Ranking within a kind"): a product with any failed check is left out. All `ok` come before any `unclear`. Then the closest fit: the smallest continuous watts for inverters, the fewest units (then the smaller bank) for batteries. Then the most specs stated, then the name. At most 4 per kind. The first product is marked closest only when it is `ok`.

**Step 1: failing tests** (append; import `matchProducts`, `productKey`, `type PublicProduct`):

```ts
describe('matchProducts', () => {
  const pub = <P extends ReturnType<typeof inverter> | ReturnType<typeof battery>>(p: P, model: string): PublicProduct =>
    ({ ...p, model, key: productKey({ kind: p.kind, brand: p.brand, model }) })
  const inv = (model: string, w: number, specs = {}) => pub(inverter({ continuousW: stated(w, `${w}W`), ...specs }), model)

  test('drops products that fail, puts fits before checks, and the closest fit first', () => {
    const vaOnly = { surges: [{ w: null, seconds: 10, asWritten: '24,000VA', source: SHEET }] }
    const out = matchProducts([inv('Big', 12000), inv('Check', 3000, vaOnly), inv('Small', 2000), inv('Close', 3000)], NEEDS)
    expect(out.inverters.map((m) => [m.product.model, m.grade, m.isClosest])).toEqual([
      ['Close', 'ok', true], ['Big', 'ok', false], ['Check', 'unclear', false],
    ])
  })
  test('keeps at most four of a kind', () => {
    const many = [3000, 4000, 5000, 6000, 8000].map((w) => inv(`M${w}`, w))
    expect(matchProducts(many, NEEDS).inverters.map((m) => m.product.model)).toEqual(['M3000', 'M4000', 'M5000', 'M6000'])
  })
  test('ranks batteries by the fewest units and carries the bank', () => {
    const big = pub(battery({ kWh: stated(14.3, '14.3kWh'), ah: stated(280, '280Ah') }), 'Wall')
    const out = matchProducts([pub(battery(), 'Rack'), big], NEEDS)
    expect(out.batteries.map((m) => [m.product.model, m.bank?.units])).toEqual([['Wall', 2], ['Rack', 4]])
  })
  test('the first product is not called closest when it only needs checking', () => {
    const out = matchProducts([inv('Check', 3000, { surges: [] })], NEEDS)
    expect(out.inverters[0]).toMatchObject({ grade: 'unclear', isClosest: false })
  })
})
```

**Step 2:** run, expect FAIL.

**Step 3: implement** (append; add `PublicProduct` to the schema import):

```ts
type InverterProduct = Extract<PublicProduct, { kind: 'inverter' }>
type BatteryProduct = Extract<PublicProduct, { kind: 'battery' }>
type ShownGrade = Exclude<FitGrade, 'fails'>
export interface InverterMatch { product: InverterProduct; checks: FitCheck[]; grade: ShownGrade; isClosest: boolean }
export interface BatteryMatch { product: BatteryProduct; checks: FitCheck[]; grade: ShownGrade; bank: BatteryBank | null; isClosest: boolean }
export interface ProductMatches { inverters: InverterMatch[]; batteries: BatteryMatch[] }
export const MATCH_LIMIT = 4

/** How many specs a datasheet states: values that are not null, and lists that are not empty. */
function statedCount(specs: Record<string, unknown>): number {
  return Object.values(specs).filter((v) => (Array.isArray(v) ? v.length > 0 : (v as { value: unknown }).value !== null)).length
}
const nameOf = (p: PublicProduct): string => `${p.brand} ${p.model}`
const gradeRank = (g: ShownGrade): number => (g === 'ok' ? 0 : 1)
/** Compares by each key in turn; the first difference decides. */
const byKeys = (a: readonly (number | string)[], b: readonly (number | string)[]): number => {
  const i = a.findIndex((x, j) => x !== b[j])
  if (i === -1) return 0
  const [x, y] = [a[i]!, b[i]!]
  return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
}
const isShown = <M extends { grade: FitGrade }>(m: M): m is M & { grade: ShownGrade } => m.grade !== 'fails'
const withClosest = <M extends { grade: ShownGrade }>(ms: readonly M[]): (M & { isClosest: boolean })[] =>
  ms.map((m, i) => ({ ...m, isClosest: i === 0 && m.grade === 'ok' }))

export function matchProducts(products: readonly PublicProduct[], n: ProductNeeds, limit: number = MATCH_LIMIT): ProductMatches {
  const inverters = products
    .filter((p): p is InverterProduct => p.kind === 'inverter')
    .map((product) => {
      const checks = inverterChecks(product.specs, n)
      return { product, checks, grade: overall(checks) }
    })
    .filter(isShown)
    .sort((a, b) => byKeys(
      [gradeRank(a.grade), a.product.specs.continuousW.value ?? Infinity, -statedCount(a.product.specs), nameOf(a.product)],
      [gradeRank(b.grade), b.product.specs.continuousW.value ?? Infinity, -statedCount(b.product.specs), nameOf(b.product)],
    ))
    .slice(0, limit)
  const batteries = products
    .filter((p): p is BatteryProduct => p.kind === 'battery')
    .map((product) => {
      const { checks, bank } = batteryChecks(product.specs, n)
      return { product, checks, bank, grade: overall(checks) }
    })
    .filter(isShown)
    .sort((a, b) => byKeys(
      [gradeRank(a.grade), a.bank?.units ?? Infinity, a.bank?.bankWh ?? Infinity, -statedCount(a.product.specs), nameOf(a.product)],
      [gradeRank(b.grade), b.bank?.units ?? Infinity, b.bank?.bankWh ?? Infinity, -statedCount(b.product.specs), nameOf(b.product)],
    ))
    .slice(0, limit)
  return { inverters: withClosest(inverters), batteries: withClosest(batteries) }
}
```

`.filter()` returns a new array, so the `.sort()` after it mutates nothing shared.

**Step 4:** run, expect PASS; `npm run test:coverage` keeps `product-fit.ts` at or above 80% on every measure. **Step 5:** commit `feat: match and rank library products against a kit`.

---

### Task 4: The products dictionary

**Files:**
- Create: `src/i18n/products-en.ts`, `src/i18n/products-es.ts`
- Modify: `src/i18n/types.ts`, `src/i18n/index.ts`, `src/i18n/en.ts`, `src/i18n/es.ts`, `src/i18n/i18n.test.ts`

**Step 1: failing test** (in `i18n.test.ts`, beside the requester parity test):

```ts
test('products strings exist in both languages', () => {
  expect(Object.keys(es.products).sort()).toEqual(Object.keys(en.products).sort())
  for (const d of [en, es]) for (const v of Object.values(d.products)) expect(v).toBeTruthy()
})
```

**Step 2:** run `npx vitest run src/i18n/i18n.test.ts`, expect FAIL.

**Step 3:** create `src/i18n/products-en.ts`:

```ts
export const productsEn = {
  cardTitle: 'Products that fit this kit',
  cardBody: 'Real models whose datasheets meet what this kit needs. Open one for its spec sheet.',
  needsLabel: 'Your kit needs',
  needInverter: 'Inverter ≥ {w}',
  needSurge: '{w} surge for {time}',
  needVolts: '{v} V',
  needBattery: '{chemistry} ≥ {kwh} usable',
  needDischarge: '≥ {a} A discharge',
  needSplitPhase: '120/240 V split-phase',
  needSolar: 'Takes {w} of solar',
  inverters: 'Inverters',
  batteries: 'Batteries',
  countFit: '{fit} fit',
  countCheck: '{check} to check',
  countFitCheck: '{fit} fit · {check} to check',
  fits: 'Fits',
  check: 'Check',
  closest: 'Closest fit',
  fewest: 'Fewest units',
  fitsKit: 'Fits this kit',
  checkOne: 'Check one thing',
  checkMany: 'Check {count} things',
  seconds: '{n} s',
  minutes: '{n} min',
  surgeFor: '{w} for {time}',
  surgeVaOnly: 'surge stated in VA only',
  surgeNoTime: 'surge time not stated',
  surgeNone: 'no surge stated',
  unitsOne: '1 unit',
  unitsMany: '{count} units',
  lineBattery: '{units} · {bank} bank · {usable} usable',
  lineBatteryNoBank: 'Bank size needs the datasheet',
  eachAmps: '{total} A, {each} A each',
  parallelUsed: '{max} allowed, {used} used',
  notStated: 'Not stated',
  notNeeded: 'Not needed',
  yes: 'Yes',
  no: 'No',
  upTo: 'Up to {n}',
  years: '{n} years',
  cycles: '{n} cycles',
  whyNotStated: 'The datasheet does not state: {what}',
  whySurgeVa: 'The datasheet gives the surge only in VA. Ask the seller for it in watts.',
  whySurgeNoTime: 'The datasheet gives a surge with no duration. Ask the seller how long it holds.',
  colDecides: 'What decides fit',
  colSays: 'Datasheet says',
  colNeeds: 'Your kit needs',
  asWritten: 'As written: “{text}”',
  rest: 'The rest of the sheet',
  meets: 'Meets the need',
  unknown: 'Not stated',
  disclaimer: "Specs are copied from each maker's datasheet by AI, and every value links to where it was read. Check the datasheet before you buy.",
  openDatasheet: 'Open the datasheet',
  makerPage: "Maker's page",
  next: 'Next: {name}',
  backToFirst: 'Back to the first: {name}',
  position: '{n} of {total}',
  kindInverter: 'Inverter',
  kindBattery: 'Battery',
  priceSeen: '{price} at {seller}, seen {date}',
  specContinuous: 'Continuous power',
  specSurge: 'Surge',
  specBatteryVolts: 'Battery voltage',
  specSplitPhase: 'Split-phase output',
  specSolarInput: 'Solar input',
  specSolarVolts: 'Max solar voltage',
  specCharger: 'Built-in charger',
  specUnitsParallel: 'Units in parallel',
  specComms: 'Battery comms',
  specIdle: 'Idle draw',
  specEfficiency: 'Efficiency',
  specWarranty: 'Warranty',
  specChemistry: 'Chemistry',
  specUnitVolts: 'Unit voltage',
  specEnergy: 'Usable energy',
  specDischarge: 'Continuous discharge',
  specParallel: 'Parallel limit',
  specUnit: 'One unit',
  specBank: 'Bank energy',
  specPeak: 'Peak discharge',
  specCycles: 'Cycle life',
  specBrands: 'Compatible brands',
}
```

`src/i18n/products-es.ts` holds the same keys typed `Record<keyof typeof productsEn, string>`, in Latin American Spanish, in the voice of `quotes-es.ts` (for example `cardTitle: 'Productos que sirven para este kit'`, `fits: 'Sirve'`, `check: 'Revisar'`, `closest: 'El más ajustado'`, `fewest: 'Menos unidades'`, `openDatasheet: 'Abrir la ficha técnica'`, `next: 'Siguiente: {name}'`, `backToFirst: 'Volver al primero: {name}'`, `disclaimer: 'Las especificaciones se copian con IA de la ficha técnica de cada fabricante, y cada valor enlaza a donde se leyó. Revisa la ficha técnica antes de comprar.'`). Translate every key; none may stay in English.

**Step 4:** wire it in:
- `types.ts`: `import type { productsEn } from './products-en'`; add `products: Record<ProductTextKey, string>` to `Dictionary`; `export type ProductTextKey = keyof typeof productsEn`.
- `en.ts` / `es.ts`: `products: productsEn` / `products: productsEs`.
- `index.ts`: export the type, and add beside `trq`:

```ts
export function trp(t: Dictionary, key: ProductTextKey, params: Record<string, string | number> = {}): string {
  return fill(t.products[key], params)
}
```

**Step 5:** run the i18n test and `npm run typecheck`, expect PASS. **Step 6:** commit `feat: product strings in English and Spanish`.

---

### Task 5: Words for the card and the sheet

**Files:**
- Create: `src/lib/product-text.ts`
- Test: `src/lib/product-text.test.ts`

The components render what this module returns; they format nothing themselves.

**Step 1: failing tests** (`src/lib/product-text.test.ts`), using the `en` dictionary and the fixtures, `NEEDS` included:

```ts
import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { matchProducts } from './product-fit'
import { battery, inverter, NEEDS, SHEET, stated } from './product-fixtures'
import { productKey, type PublicProduct } from './product-schema'
import { countLine, needChips, rowFor, sheetFor } from './product-text'

const pub = (p: ReturnType<typeof inverter> | ReturnType<typeof battery>): PublicProduct => ({ ...p, key: productKey(p) })
const one = (p: PublicProduct) => matchProducts([p], NEEDS)

describe('needChips', () => {
  test('lists what the kit asks of a product', () => {
    expect(needChips(en, NEEDS)).toEqual(['Inverter ≥ 2,582 W', '3,115 W surge for 3 s', '48 V', 'LiFePO₄ ≥ 13.1 kWh usable', '≥ 48 A discharge'])
  })
})

describe('rowFor', () => {
  test('an inverter row shows the power and the surge level that covers the start-up', () => {
    expect(rowFor(en, one(pub(inverter())).inverters[0]!, NEEDS)).toMatchObject({
      name: 'EG4 Electronics 6000XP', line: '6,000 W · 12,000 W for 3.5 s', pill: 'Fits', badge: 'Closest fit', note: null,
    })
  })
  test('a VA-only surge says so and explains what to ask', () => {
    const va = pub(inverter({ surges: [{ w: null, seconds: 10, asWritten: '24,000VA', source: SHEET }] }))
    expect(rowFor(en, one(va).inverters[0]!, NEEDS)).toMatchObject({
      line: '6,000 W · surge stated in VA only', pill: 'Check', badge: null,
      note: 'The datasheet gives the surge only in VA. Ask the seller for it in watts.',
    })
  })
  test('a battery row shows the bank sized for the kit', () => {
    expect(rowFor(en, one(pub(battery())).batteries[0]!, NEEDS)).toMatchObject({
      name: 'Pytes V5', line: '4 units · 20.5 kWh bank · 17.4 kWh usable', pill: 'Fits', badge: 'Fewest units',
    })
  })
})

describe('countLine', () => {
  test('counts fits and checks, leaving out a zero', () => {
    expect(countLine(en, ['ok', 'ok', 'unclear'])).toBe('2 fit · 1 to check')
    expect(countLine(en, ['ok'])).toBe('1 fit')
    expect(countLine(en, ['unclear'])).toBe('1 to check')
  })
})

describe('sheetFor', () => {
  const sheet = sheetFor(en, one(pub(inverter())).inverters[0]!, NEEDS)
  test('the rows that decide fit carry the datasheet value, its words, its source and the need', () => {
    expect(sheet.decides).toEqual([
      { id: 'continuous', label: 'Continuous power', value: '6,000 W', source: SHEET, asWritten: 'NOMINAL POWER OUTPUT 6000W', need: '≥ 2,582 W', grade: 'ok' },
      { id: 'surge', label: 'Surge', value: '12,000 W for 3.5 s · 11,000 W for 5 s', source: SHEET, asWritten: '12,000W for ≈3.5 seconds | 11,000W for ≈5 seconds', need: '≥ 3,115 W for 3 s', grade: 'ok' },
      { id: 'batteryVolts', label: 'Battery voltage', value: '48 V', source: SHEET, asWritten: 'NOMINAL VOLTAGE 48 VDC', need: '48 V', grade: 'ok' },
    ])
  })
  test('the rest of the sheet lists only what the datasheet states', () => {
    expect(sheet.rest.map((r) => r.label)).toEqual(['Split-phase output', 'Units in parallel', 'Battery comms', 'Warranty'])
  })
  test('carries the heading, the verdict and the links', () => {
    expect(sheet).toMatchObject({ kind: 'Inverter', brand: 'EG4 Electronics', title: 'EG4 Electronics 6000XP', verdict: 'Fits this kit', badge: 'Closest fit', datasheetUrl: SHEET, makerUrl: null, price: null })
  })
  test('a battery sheet sizes the bank in its deciding rows', () => {
    const b = sheetFor(en, one(pub(battery())).batteries[0]!, NEEDS)
    expect(b.decides.map((r) => [r.id, r.value, r.need])).toEqual([
      ['chemistry', 'LiFePO₄', 'LiFePO₄'],
      ['unitVolts', '51.2 V', '48 V'],
      ['energy', '17.4 kWh with 4 units', '≥ 13.1 kWh'],
      ['discharge', '400 A, 100 A each', '≥ 48 A'],
      ['parallel', '16 allowed, 4 used', '4'],
    ])
  })
})
```

**Step 2:** run, expect FAIL.

**Step 3: implement** `src/lib/product-text.ts` with these exports, each a pure function of the dictionary and the match:

```ts
export interface ProductRowView { key: string; name: string; line: string; note: string | null; pill: string; isCheck: boolean; badge: string | null }
export interface SheetRow { id: string; label: string; value: string; source: string | null; asWritten: string | null; need: string | null; grade: FitGrade | null }
export interface ProductSheetView {
  key: string; kind: string; brand: string; title: string; verdict: string; isCheck: boolean; badge: string | null; note: string | null
  decides: SheetRow[]; rest: SheetRow[]; extras: { name: string; value: string; source: string }[]
  datasheetUrl: string; makerUrl: string | null; price: string | null
}
export function needChips(t: Dictionary, n: ProductNeeds): string[]
export function countLine(t: Dictionary, grades: readonly FitGrade[]): string
export function rowFor(t: Dictionary, m: InverterMatch | BatteryMatch, n: ProductNeeds): ProductRowView
export function sheetFor(t: Dictionary, m: InverterMatch | BatteryMatch, n: ProductNeeds): ProductSheetView
```

Rules the tests pin down, and the ones they leave to you:
- Numbers go through `fmtW`, `fmtKwh`, `fmtInt` and `fmtDecimal` from `src/i18n/format.ts`; chemistry names come from `t.chemistries`. A duration under 60 s reads `{n} s` (one decimal only when needed: `3.5 s`, `5 s`), from 60 s up `{n} min`.
- `name` and `title` are `brand + ' ' + model`, except when the model already starts with the brand (case-insensitive), then the model alone. The brand line on the sheet is `brand`.
- An inverter's line is its continuous power, then the surge level `surgeRating` picked for the kit's start-up; with no usable level it is the `surgeVaOnly`, `surgeNoTime` or `surgeNone` text matching the check's reason.
- `note` is null for an `ok` match. For an `unclear` one it explains the first unclear check: `whySurgeVa`, `whySurgeNoTime`, or `whyNotStated` with that check's spec label, lower-cased.
- `pill` is `fits` or `check`; `verdict` is `fitsKit`, `checkOne` or `checkMany` by the number of unclear checks. `badge` is `closest` (inverter) or `fewest` (battery) when `isClosest`, else null.
- A deciding row's `value`, `source` and `asWritten` come from the spec the check reads. The surge row joins every level's watts and time with ` · `, takes the first level's source, and joins the levels' `asWritten` with ` | `. An unstated value reads `notStated` with null source and words.
- Battery deciding rows: chemistry (need: the kit's chemistry name), unit voltage (need: the kit's volts), usable energy (`'{usable} with {units}'`, need `≥ {kwh}`), discharge (`eachAmps` with the bank's total, need `≥ {a} A`), parallel (`parallelUsed`, need: the strings the bank uses). With no bank, energy and parallel read `notStated`.
- `rest` lists, in this order and only when stated: for inverters split-phase (when the kit does not need it), solar input and max solar voltage (when the kit has no panels), charger, units in parallel, battery comms (`CAN, RS485`), idle draw, efficiency, warranty, compatible brands; for batteries one unit (`'{v} V · {ah} Ah · {kwh}'`), bank energy, peak discharge (`'{a} A for {time}'`), cycle life, battery comms, warranty, compatible brands. Each carries its spec's `source` and `asWritten`; `need` and `grade` are null.
- `extras` are the product's `extraSpecs` as they are. `price` is `priceSeen` with `fmtMoney` and `fmtDate`, or null.

Keep every function under 50 lines: one small formatter per row kind, and two builders (`inverterDecides`, `batteryDecides`) that map each check id to its row.

**Step 4:** run, expect PASS; coverage for `product-text.ts` at or above 80%. **Step 5:** commit `feat: card and spec-sheet text for library products`.

---

### Task 6: Load the library with the page

**Files:**
- Modify: `src/server/product-repo.ts`, `src/hooks/useRootData.ts`, `src/routes/__root.tsx`
- Create: `src/server/products.ts`, `src/hooks/useProducts.ts`

The root loader already loads the appliance catalog once per page load, and `e2e/kit-builder.spec.ts` ("moving between steps does not wait on the server") requires that step changes call no server function. So the library loads there too. Revisit when it passes about 100 products: the payload is about 2 KB each.

**Step 1:** in `src/server/product-repo.ts` add a cached public read, and clear it on write:

```ts
import { ttlCache } from '../lib/ttl-cache'
import { toPublicProduct, type PublicProduct } from '../lib/product-schema'

export const PRODUCTS_TTL_MS = 60_000
export const productsCache = ttlCache<PublicProduct[]>(PRODUCTS_TTL_MS)

/** What the app shows: the library without retired products and without admin fields. */
export async function queryPublicProducts(): Promise<PublicProduct[]> {
  return (await listProducts()).filter((p) => !p.retired).map(toPublicProduct)
}
```

In `upsertProducts`, right after the insert, add `productsCache.clear()` (inside the `if (toWrite.length > 0)` block), as `upsertAppliances` clears `catalogCache`.

**Step 2:** create `src/server/products.ts`, mirroring `src/server/catalog.ts`:

```ts
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { PublicProduct } from '../lib/product-schema'
import { withFallback } from '../lib/ttl-cache'
import { productsCache, queryPublicProducts } from './product-repo'

/** The product library on the server; empty when the database cannot be read, so the kit step still renders. */
export const loadProducts = createServerOnlyFn((): Promise<PublicProduct[]> =>
  withFallback(() => productsCache.get(queryPublicProducts), [], (error) =>
    console.error('[getProducts] product query failed; showing no products', error),
  ),
)

export const getProducts = createServerFn({ method: 'GET' }).handler(async (): Promise<PublicProduct[]> => loadProducts())
```

**Step 3:** add `products: PublicProduct[]` to `RootData` in `useRootData.ts` (fallback `data?.products ?? []`), load it in `__root.tsx`'s `Promise.all` with `getProducts()`, and create `src/hooks/useProducts.ts`:

```ts
import type { PublicProduct } from '../lib/product-schema'
import { useRootData } from './useRootData'

/** The product library loaded once with the page; empty until slice 1's table has rows. */
export function useProducts(): readonly PublicProduct[] {
  return useRootData().products
}
```

**Step 4:** `npm run typecheck && npm test`. Expected: PASS. **Step 5:** commit `feat: load the product library with the page`.

---

### Task 7: The card and the sheet, driven by an e2e test

**Files:**
- Create: `e2e/products.spec.ts`, `src/styles/products.css`, `src/components/products/ProductsCard.tsx`, `src/components/products/ProductRow.tsx`, `src/components/products/ProductSheet.tsx`
- Modify: `src/styles.css` (import), `src/components/KitStep.tsx`

**Step 1: the failing e2e test** (`e2e/products.spec.ts`). The default kit at `/?step=4` needs an inverter of at least 582 W with a 1,515 W surge for 3 s at 48 V, and 4.1 kWh usable at 11 A. Desktop seeds inverters and phone seeds batteries, so the two projects never compete for the four places of one list:

```ts
import { expect, test, type APIRequestContext } from '@playwright/test'
import { productKey } from '../src/lib/product-schema'
import { catalogAuthHeader as auth } from './catalog-token'
import { deleteTestProduct } from './db'

const SHEET = 'https://example.com/e2e-datasheet.pdf'
const NONE = { value: null, source: null, asWritten: null }
const stated = <T,>(value: T, asWritten: string) => ({ value, source: SHEET, asWritten })
const BRAND = 'E2E Power'

function inverter(model: string, watts: number) {
  return {
    kind: 'inverter' as const, brand: BRAND, model, makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      continuousW: stated(watts, `Rated power ${watts}W`),
      surges: [{ w: watts * 3, seconds: 5, asWritten: `${watts * 3}W for 5 seconds`, source: SHEET }],
      batteryVolts: stated(48, '48 VDC'), splitPhase: NONE, chargerA: NONE, pvInputW: NONE, pvVocMax: NONE,
      maxParallelUnits: NONE, idleW: NONE, peakEfficiencyPct: NONE, warrantyYears: stated(5, '5 years'), bmsComms: ['can' as const], compatibleBatteryBrands: [],
    },
  }
}
function battery(model: string, kWh: number) {
  return {
    kind: 'battery' as const, brand: BRAND, model, makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      chemistry: stated('lifepo4' as const, 'LiFePO4'), nominalV: stated(51.2, '51.2V'), ah: NONE, kWh: stated(kWh, `${kWh}kWh`),
      maxContinuousA: stated(100, '100A'), peakA: NONE, peakSeconds: NONE, maxParallel: stated(16, '16 units'),
      cycleLife: NONE, warrantyYears: NONE, bmsComms: ['can' as const], compatibleInverterBrands: [],
    },
  }
}
const seed = (request: APIRequestContext, items: unknown[]) => request.post('/api/catalog/products', { headers: auth, data: items })
const keysOf = (items: { kind: 'inverter' | 'battery'; brand: string; model: string }[]) => items.map(productKey)

test('desktop: the kit lists inverters that fit and opens their spec sheets', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop seeds inverters; phone seeds batteries')
  const stamp = Date.now()
  // 300 W is under the kit's 582 W, so it must never be listed.
  const items = [inverter(`A${stamp}`, 600), inverter(`B${stamp}`, 1000), inverter(`C${stamp}`, 300)]
  try {
    expect((await seed(request, items)).ok()).toBe(true)
    await page.goto('/?step=4')
    const card = page.getByRole('region', { name: 'Products that fit this kit' })
    await expect(card.getByText('Inverter ≥ 582 W')).toBeVisible()
    await expect(card.getByRole('button', { name: new RegExp(`E2E Power C${stamp}`) })).toHaveCount(0)
    const first = card.getByRole('button', { name: new RegExp(`E2E Power A${stamp}`) })
    await expect(first).toContainText('600 W · 1,800 W for 5 s')
    await expect(first).toContainText('Closest fit')
    await first.click()
    const sheet = page.getByRole('dialog', { name: `E2E Power A${stamp}` })
    await expect(sheet.getByText('Fits this kit')).toBeVisible()
    await expect(sheet.getByText('As written: “Rated power 600W”')).toBeVisible()
    await expect(sheet.getByRole('link', { name: '600 W' })).toHaveAttribute('href', SHEET)
    await expect(sheet.getByRole('link', { name: 'Open the datasheet' })).toHaveAttribute('href', SHEET)
    await sheet.getByRole('button', { name: `Next: E2E Power B${stamp}` }).click()
    const second = page.getByRole('dialog', { name: `E2E Power B${stamp}` })
    await expect(second.getByRole('button', { name: `Back to the first: E2E Power A${stamp}` })).toBeVisible()
    await second.getByRole('button', { name: 'Close' }).click()
    await expect(second).toBeHidden()
  } finally {
    for (const key of keysOf(items)) await deleteTestProduct(key)
  }
})

test('phone: the kit lists batteries with their bank and opens the sheet from the bottom', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'phone', 'desktop seeds inverters; phone seeds batteries')
  const stamp = Date.now()
  const items = [battery(`W${stamp}`, 5.12), battery(`S${stamp}`, 2.4)]
  try {
    expect((await seed(request, items)).ok()).toBe(true)
    await page.goto('/?step=4')
    const card = page.getByRole('region', { name: 'Products that fit this kit' })
    const row = card.getByRole('button', { name: new RegExp(`E2E Power W${stamp}`) })
    await expect(row).toContainText('1 unit · 5.1 kWh bank · 4.4 kWh usable')
    await expect(row).toContainText('Fewest units')
    await row.click()
    const sheet = page.getByRole('dialog', { name: `E2E Power W${stamp}` })
    await expect(sheet.getByText('16 allowed, 1 used')).toBeVisible()
    await expect(sheet.getByRole('button', { name: `Next: E2E Power S${stamp}` })).toBeVisible()
  } finally {
    for (const key of keysOf(items)) await deleteTestProduct(key)
  }
})

```

There is no e2e test for "no card when nothing fits": desktop and phone run in parallel against one database, so an empty library cannot be assumed. `matchProducts` returning two empty lists is unit-tested, and the card returns null for it. The seeded rows of one project can show on the other project's page; nothing asserts they don't.

**Step 2:** `npx playwright test e2e/products.spec.ts`. Expected: the two seeded tests FAIL (no card).

**Step 3: styles** (`src/styles/products.css`, imported last in `src/styles.css`). Reuse `.qpill--ok`, `.qpill--warn`, `.qpill--best`, `.qmark--ok`, `.qmark--short`, `.qdialog*`, `.lab`, `.btn`, `.fine` and `.num`; add only what is new, with the canvas's values:

```css
/* Products that fit the kit: a card with two lists, and a spec sheet that reuses the quotes dialog. */
.prod { border: 1px solid var(--line); border-radius: 16px; padding: 16px; background: var(--surface); display: flex; flex-direction: column; gap: 16px; }
.prod__head { display: flex; flex-direction: column; gap: 6px; }
.prod__title { margin: 0; font-size: 20px; letter-spacing: -0.01em; line-height: 1.1; }
.prod__needs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 14px; border-radius: 12px; background: var(--ground); }
.prod__chip { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); }
.prod__cols { display: grid; grid-template-columns: 1fr; gap: 20px; }
.prod__group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.prod__group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.prod__group-title { margin: 0; font-family: var(--font-body); font-size: 15px; font-weight: 700; letter-spacing: 0; }
.prod__list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; }
.prod__list > li + li { border-top: 1px solid var(--line); }
.prod__row { width: 100%; min-height: 72px; display: flex; align-items: center; gap: 12px; padding: 12px 10px 12px 14px; border: 0; background: var(--surface); text-align: left; }
.prod__row:hover { background: var(--ground); }
.prod__row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.prod__tile { flex: 0 0 36px; height: 36px; border-radius: 10px; background: var(--ground); color: var(--muted); display: none; place-items: center; }
.prod__body { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.prod__name-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.prod__name { font-size: 15px; font-weight: 700; line-height: 1.25; }
.prod__line { font-size: 13px; }
.prod__note { font-size: 12.5px; color: var(--warn-ink); }
.prod__chev { flex-shrink: 0; color: var(--faint); }
.psheet__kind { padding-right: 52px; }
.psheet__pills { display: flex; flex-wrap: wrap; gap: 8px; }
.psheet__note { padding: 12px 14px; border-radius: 12px; background: var(--warn-bg); border: 1px solid var(--warn-border); color: var(--warn-ink); font-size: 13.5px; }
.psheet__cols { display: none; }
.psheet__row { display: flex; flex-direction: column; gap: 4px; padding: 12px 0; border-top: 1px solid var(--line); }
.psheet__label { font-size: 12.5px; font-weight: 600; color: var(--muted); }
.psheet__value { font-size: 16px; font-weight: 700; color: var(--ink); text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
.psheet__quote { font-size: 12.5px; color: var(--muted); }
.psheet__need { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.psheet__rest-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 14px; }
.psheet__rest-row > span:first-child { font-size: 13.5px; color: var(--muted); }
.psheet__rest-row a { color: var(--ink); text-decoration-color: var(--line-strong); text-underline-offset: 3px; font-weight: 600; text-align: right; }
.psheet__next { width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; }
.psheet__next > span:nth-child(2) { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psheet__pos { flex-shrink: 0; font-size: 13px; color: var(--muted); }
@media (min-width: 640px) {
  .prod__tile { display: grid; }
  .psheet__cols, .psheet__row { display: grid; grid-template-columns: 138px minmax(0, 1fr) 150px; gap: 0 14px; align-items: start; }
  .psheet__cols { padding-bottom: 8px; border-bottom: 2px solid var(--ink); }
  .psheet__row { border-top: 0; border-bottom: 1px solid var(--line); }
  .psheet__label { font-size: 14px; font-weight: 700; color: var(--ink); }
  .psheet__value { font-size: 15px; font-weight: 600; }
  .psheet__need { align-items: flex-start; font-size: 14px; }
  .psheet__rest-row { display: grid; grid-template-columns: 138px minmax(0, 1fr); gap: 0 14px; }
  .psheet__rest-row a { text-align: left; font-weight: 400; }
}
@media (min-width: 1024px) {
  .prod { padding: 22px 24px; gap: 18px; }
  .prod__title { font-size: 22px; }
  .prod__cols { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
}
```

**Step 4: components.**

`ProductRow.tsx`, one list row, a real button:

```tsx
import { BatteryMedium, ChevronRight, Zap } from 'lucide-react'
import type { ProductKind } from '../../lib/product-schema'
import type { ProductRowView } from '../../lib/product-text'
import { FitPill } from './FitPill'

interface Props { kind: ProductKind; row: ProductRowView; onOpen: () => void }

export function ProductRow({ kind, row, onOpen }: Props) {
  const Icon = kind === 'inverter' ? Zap : BatteryMedium
  return (
    <li>
      <button type="button" className="prod__row" onClick={onOpen}>
        <span className="prod__tile" aria-hidden="true"><Icon size={18} /></span>
        <span className="prod__body">
          <span className="prod__name-line">
            <span className="prod__name">{row.name}</span>
            {row.badge && <span className="qpill qpill--best">{row.badge}</span>}
          </span>
          <span className="prod__line num">{row.line}</span>
          {row.note && <span className="prod__note">{row.note}</span>}
        </span>
        <FitPill label={row.pill} isCheck={row.isCheck} />
        <ChevronRight className="prod__chev" size={18} aria-hidden="true" />
      </button>
    </li>
  )
}
```

`FitPill.tsx` (same folder): `<span className={isCheck ? 'qpill qpill--warn' : 'qpill qpill--ok'}>` with a `Check` or `CircleAlert` icon (size 12, `aria-hidden`) and the label.

`ProductSheet.tsx`, the dialog, on the quotes dialog's classes (it is already a bottom sheet under 640 px):

```tsx
import { ChevronRight, ExternalLink, FileText, X } from 'lucide-react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLocale } from '../../hooks/useLocale'
import { trp } from '../../i18n'
import type { ProductSheetView, SheetRow } from '../../lib/product-text'
import { FitPill } from './FitPill'

interface Props { sheets: readonly ProductSheetView[]; index: number | null; onIndex: (index: number | null) => void }

const external = { target: '_blank', rel: 'noopener noreferrer' } as const

/** A value that links to the page it was read on; plain text when the datasheet does not state it. */
function Sourced({ row, className }: { row: SheetRow; className?: string }) {
  return row.source ? <a className={className} href={row.source} {...external}>{row.value}</a> : <span className={className}>{row.value}</span>
}

export function ProductSheet({ sheets, index, onIndex }: Props) {
  const { t } = useLocale()
  const sheet = index === null ? null : sheets[index] ?? null
  const nextIndex = index === null ? 0 : (index + 1) % sheets.length
  const next = sheets[nextIndex]
  return (
    <ModalOverlay className="qdialog__overlay" isOpen={sheet !== null} onOpenChange={(open) => { if (!open) onIndex(null) }} isDismissable>
      <Modal className="qdialog">
        {sheet && (
          <Dialog className="qdialog__body" aria-label={sheet.title}>
            {({ close }) => (
              <>
                <button type="button" className="qdialog__close" aria-label={t.ui.close} onClick={close}><X size={16} aria-hidden="true" /></button>
                <div className="lab psheet__kind">{sheet.kind} · {sheet.brand}</div>
                <Heading slot="title" className="qdialog__title">{sheet.title}</Heading>
                <div className="psheet__pills">
                  <FitPill label={sheet.verdict} isCheck={sheet.isCheck} />
                  {sheet.badge && <span className="qpill qpill--best">{sheet.badge}</span>}
                </div>
                {sheet.note && <p className="psheet__note">{sheet.note}</p>}
                <div>
                  <div className="psheet__cols" aria-hidden="true">
                    <span className="lab">{t.products.colDecides}</span><span className="lab">{t.products.colSays}</span><span className="lab">{t.products.colNeeds}</span>
                  </div>
                  {sheet.decides.map((row) => (
                    <div className="psheet__row" key={row.id}>
                      <span className="psheet__label">{row.label}</span>
                      <span>
                        <Sourced row={row} className="psheet__value num" />
                        {row.asWritten && <span className="psheet__quote" style={{ display: 'block' }}>{trp(t, 'asWritten', { text: row.asWritten })}</span>}
                      </span>
                      <span className="psheet__need num">
                        <span className={row.grade === 'ok' ? 'qmark qmark--ok' : 'qmark qmark--short'} role="img" aria-label={row.grade === 'ok' ? t.products.meets : t.products.unknown} />
                        {row.need}
                      </span>
                    </div>
                  ))}
                </div>
                {sheet.rest.length + sheet.extras.length > 0 && (
                  <div>
                    <div className="lab">{t.products.rest}</div>
                    {sheet.rest.map((row) => <div className="psheet__rest-row" key={row.id}><span>{row.label}</span><Sourced row={row} className="num" /></div>)}
                    {sheet.extras.map((x) => <div className="psheet__rest-row" key={x.name}><span>{x.name}</span><a href={x.source} {...external}>{x.value}</a></div>)}
                  </div>
                )}
                {sheet.price && <p className="qmeta">{sheet.price}</p>}
                <p className="fine muted">{t.products.disclaimer}</p>
                <div className="qdialog__actions">
                  <a className="btn btn--primary" href={sheet.datasheetUrl} {...external}><FileText size={16} aria-hidden="true" />{t.products.openDatasheet}</a>
                  {sheet.makerUrl && <a className="btn btn--quiet" href={sheet.makerUrl} {...external}>{t.products.makerPage}<ExternalLink size={16} aria-hidden="true" /></a>}
                </div>
                {sheets.length > 1 && next && index !== null && (
                  <button type="button" className="btn psheet__next" onClick={() => onIndex(nextIndex)}>
                    <span className="psheet__pos num">{trp(t, 'position', { n: index + 1, total: sheets.length })}</span>
                    <span>{trp(t, nextIndex === 0 ? 'backToFirst' : 'next', { name: next.title })}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </Dialog>
        )}
      </Modal>
    </ModalOverlay>
  )
}
```

The mark inside `.qmark` needs its icon: render lucide's `Check` or `CircleAlert` (size 12) inside it rather than leaving the span empty, with the `role="img"` and label on the span. The sources are https URLs the Zod schema checked on write and on read, so they are safe in `href`.

`ProductsCard.tsx`, the card. It builds the text once and owns which sheet is open:

```tsx
import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { useProducts } from '../../hooks/useProducts'
import { matchProducts, productNeeds } from '../../lib/product-fit'
import type { ProductKind } from '../../lib/product-schema'
import { countLine, needChips, rowFor, sheetFor } from '../../lib/product-text'
import type { SizingResult } from '../../lib/sizing'
import { ProductRow } from './ProductRow'
import { ProductSheet } from './ProductSheet'

interface Props { result: SizingResult }
interface Open { kind: ProductKind; index: number }

/** Library products that fit the kit, on the kit step. Renders nothing for an empty kit or when nothing fits. */
export function ProductsCard({ result }: Props) {
  const { t } = useLocale()
  const products = useProducts()
  const [open, setOpen] = useState<Open | null>(null)
  const titleId = useId()
  if (result.empty) return null
  const needs = productNeeds(result)
  const matches = matchProducts(products, needs)
  if (matches.inverters.length + matches.batteries.length === 0) return null
  const groups = [
    { kind: 'inverter' as const, title: t.products.inverters, list: matches.inverters },
    { kind: 'battery' as const, title: t.products.batteries, list: matches.batteries },
  ].filter((g) => g.list.length > 0)
  const openGroup = groups.find((g) => g.kind === open?.kind)
  return (
    <section className="prod" aria-labelledby={titleId}>
      <div className="prod__head">
        <h3 className="prod__title" id={titleId}>{t.products.cardTitle}</h3>
        <p className="muted">{t.products.cardBody}</p>
      </div>
      <div className="prod__needs">
        <span className="lab">{t.products.needsLabel}</span>
        {needChips(t, needs).map((chip) => <span className="prod__chip num" key={chip}>{chip}</span>)}
      </div>
      <div className="prod__cols">
        {groups.map((g) => (
          <div className="prod__group" key={g.kind}>
            <div className="prod__group-head">
              <h4 className="prod__group-title">{g.title}</h4>
              <span className="qmeta">{countLine(t, g.list.map((m) => m.grade))}</span>
            </div>
            <ul className="prod__list">
              {g.list.map((m, index) => <ProductRow key={m.product.key} kind={g.kind} row={rowFor(t, m, needs)} onOpen={() => setOpen({ kind: g.kind, index })} />)}
            </ul>
          </div>
        ))}
      </div>
      <p className="fine muted">{t.products.disclaimer}</p>
      <ProductSheet
        sheets={(openGroup?.list ?? []).map((m) => sheetFor(t, m, needs))}
        index={open?.index ?? null}
        onIndex={(index) => setOpen(index === null || !open ? null : { kind: open.kind, index })}
      />
    </section>
  )
}
```

`KitStep.tsx`: import `ProductsCard` and render `<ProductsCard result={result} />` between `<KitSummary … />` and `<QuotesCard … />`.

**Step 5:** `npm run typecheck`, then `npx playwright test e2e/products.spec.ts e2e/kit-builder.spec.ts`. Expected: PASS on desktop and phone, and "moving between steps does not wait on the server" still passes.

**Step 6:** look at it. Start the `built-on-e2e-db` preview (see Safety), seed two inverters and two batteries through the token API with brand `E2E Power`, open `/?step=4` at desktop width and at 390 px, compare with canvas A1 to A4, then delete the rows with `deleteTestProduct` and stop the server. Check the sheet in the iOS Simulator's Safari too: bottom sheets have behaved differently there than in Chromium's phone emulation.

**Step 7:** commit `feat: products that fit the kit, with a spec sheet for each`.

---

### Task 8: Verify and review

**Step 1:** `npm run typecheck && npm run test:coverage`. Expected: PASS, thresholds met.

**Step 2:** `npm run e2e`. Expected: PASS (the whole suite: the card now renders on every kit page when the library has rows, so make sure nothing else moved).

**Step 3:** code review of this slice's commits (code-reviewer agent). Fix CRITICAL and HIGH findings.

**Step 4:** in the spec, note under "UI" that variant A shipped with the "Next" button, and list anything that changed from the plan.

## Rollout

The card shows nothing until the library has products. After slice 1 is deployed (its migration creates the table in production), seed it with `/research-product --from <a spike run> --target prod`, confirming each dry run.
