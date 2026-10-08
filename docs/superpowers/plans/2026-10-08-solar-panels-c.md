# Solar Panels Step (Variant C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional "Solar panels" step between the backup window and the kit: the person enters roof space, the planner pre-fills the recommended number of panels, they tap tiles to add or remove, and the kit gains panels, a charge controller, PV wiring, a disconnect and mounting.

**Architecture:** A pure `src/lib/solar.ts` module owns the constants (panel, efficiency, controller sizes), the recommendation and the sizing of the solar side (`sizeSolar`). `compute` in `src/lib/sizing.ts` calls it after the battery is picked and returns `result.solar`. `Project` gains a nullable `solar` object (`roofM2`, `panels`, `sunHours`), synced through one nullable `jsonb` column like `requester`. The wizard becomes four steps; step 3 is `SolarStep` (`RoofPlanner` + `SolarFlow`), and the kit page becomes step 4. `buildParts` appends five solar rows, so the parts table, the PDF/PNG sheet and the CSV pick them up without further changes.

**Tech Stack:** React 19, TanStack Start (server functions), zod 4, Drizzle ORM + Neon Postgres, Vitest (node, `src/**/*.test.ts`), Playwright (desktop + phone projects), lucide-react icons.

**Design:** canvas https://claude.ai/artifact/EdQ76w4D7hjfvYRBzeWEYG, boards "C · Own step with a roof planner" (desktop and phone). Variant C merged with variant A's roof-area input: the area drives how many tiles the planner shows; the recommended count is pre-filled; tapping overrides it.

## Global Constraints

- **Never run `npm run db:migrate` locally.** `drizzle.config.ts` loads `.env.local`, which points at **production**. Vercel runs the migration on deploy. The e2e branch is migrated only with the guarded command in Task 4.
- The worktree needs `.env.local` and `.env.test.local` symlinked from the main checkout before e2e: `ln -s ../../../.env.local .env.local && ln -s ../../../.env.test.local .env.test.local` (run at the worktree root).
- Every string the UI shows comes from the dictionaries. `en` and `es` must have the same keys (`src/i18n/i18n.test.ts` enforces it).
- Immutable updates only: return new objects, never mutate arguments or state.
- Vitest runs in `node` with no DOM. Components are covered by Playwright, pure logic by Vitest. Coverage on `src/lib` and `src/i18n` stays ≥ 80% (`npm run test:coverage`).
- Files stay under 400 lines; split components when they grow past that.
- Commit messages: `<type>: <description>`, with no attribution lines.
- Do not push, open a PR or merge without the user's explicit OK.

## Decisions already made (don't re-litigate)

| Question | Decision |
|---|---|
| Where solar lives on `Project` | `solar: { roofM2, panels, sunHours } \| null`. `null` = batteries only. `panels: null` = "use the recommended count". |
| What "recommended" means | The fewest panels that refill the **whole bank** (`battery.bankWh`) in one clear day at the chosen sun hours, capped by what the roof fits. |
| "A day's use" for the coverage bar | `averageW × 24 h` (the selected load for a full day), not the window's `loadWh`. |
| Panel | 550 W mono, 2.28 × 1.13 m, Voc 49.6 V, Isc 14 A. 3 m² per panel including walkways. |
| Panel-to-battery efficiency | 75%. Cloudy day = 40% of a clear day. |
| Default sun hours | 4.8 (Caracas, yearly average). Range 3–6.5 in 0.5 steps. |
| Roof range | 5–500 m² in 5 m² steps. |
| Strings | Up to 5 panels in series (248 V open circuit, under the 450 V controller limit). |
| Charge controller | MPPT, 450 V max PV, from `[30, 40, 60, 80, 100]` A. Charge current = `arrayW / chargeV(volts)` with chargeV = 14.4 / 28.8 / 43.2 / 57.6. Over 100 A: two or more controllers, strings split between them, and **each controller gets at least one string** (`strings = max(ceil(panels / 5), controllers)`, `perString = ceil(panels / strings)`). |
| PV cable | 6 mm² (10 AWG) solar cable, one pair per string, 20 m each (`PV_RUN_M`). |
| PV disconnect | One DC breaker per controller, ≥ 1.25 × Isc × strings on that controller, from `[16, 20, 25, 32, 40, 63]` A. |
| URL for the kit | `?step=4`. Every e2e that visited `/?step=3` for the kit moves to `/?step=4`. |
| Quotes verdict | Untouched. `kitNeeds` does not check panels (out of scope). |
| Project cards and quick edit | Untouched (no solar there). |

## Review Focus

1. **A saved `solar` that no longer parses** (hand-edited storage, a future schema change): projects still load and only `solar` becomes `null`. Tested in Task 2.
2. **Roof shrinks below the tapped count:** the engine clamps `panels` to what fits, the planner shows fewer tiles, nothing throws. Tested in Task 1 (`sizeSolar` clamp) and Task 8 (e2e).
3. **Sun hours change after tapping:** the recommended count changes, a tapped count stays until "Back to recommended". Tested in Task 1 (`recommendedPanels`) and Task 8.
4. **Step 4 links:** every `/?step=3` in e2e now means the solar step; the kit is `/?step=4`. Task 6 does the rename; Task 8 runs the whole suite.
5. **The spec sheet and CSV with solar rows** still render parts first and keep the row order. Tested in Task 7 (unit) and Task 8 (CSV e2e).

---

### Task 1: Solar engine (`src/lib/solar.ts`)

**Files:**
- Create: `src/lib/solar.ts`
- Test: `src/lib/solar.test.ts`

**Interfaces:**
- Produces: `SOLAR` constants, `SolarInput`, `SolarPick`, `panelsFit`, `panelsToRefill`, `recommendedPanels`, `sizeSolar`.
- Consumed by: Task 3 (`compute`), Task 5 (`SolarStep`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/solar.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { panelsFit, panelsToRefill, recommendedPanels, sizeSolar, SOLAR } from './solar'

// The design's sample: 48 V, 2 × 48 V 200 Ah = 19,200 Wh bank, 1,100 W average draw.
const BANK_WH = 19_200
const AVERAGE_W = 1_100

describe('panelsFit', () => {
  test('three square metres per panel, rounded down, never negative', () => {
    expect(panelsFit(40)).toBe(13)
    expect(panelsFit(5)).toBe(1)
    expect(panelsFit(2)).toBe(0)
    expect(panelsFit(-10)).toBe(0)
  })
})

describe('panelsToRefill', () => {
  test('is the panels that refill the whole bank in one clear day', () => {
    // 19,200 / (550 × 5 × 0.75) = 9.3 → 10
    expect(panelsToRefill(BANK_WH, 5)).toBe(10)
    // 19,200 / (550 × 4.8 × 0.75) = 9.7 → 10
    expect(panelsToRefill(BANK_WH, 4.8)).toBe(10)
    expect(panelsToRefill(BANK_WH, 3)).toBe(16)
    expect(panelsToRefill(0, 5)).toBe(0)
  })
})

describe('recommendedPanels', () => {
  test('is the refill count, capped by the roof', () => {
    expect(recommendedPanels({ bankWh: BANK_WH, roofM2: 40, sunHours: 5 })).toBe(10)
    expect(recommendedPanels({ bankWh: BANK_WH, roofM2: 20, sunHours: 5 })).toBe(6)
  })
})

describe('sizeSolar', () => {
  const base = { solar: { roofM2: 40, panels: null, sunHours: 5 }, bankWh: BANK_WH, volts: 48 as const, averageW: AVERAGE_W }

  test('returns null without a solar choice', () => {
    expect(sizeSolar({ ...base, solar: null })).toBeNull()
  })

  test('sizes the recommended array at 48 V', () => {
    const s = sizeSolar(base)!
    expect(s.panels).toBe(10)
    expect(s.isRecommended).toBe(true)
    expect(s.recommended).toBe(10)
    expect(s.fit).toBe(13)
    expect(s.arrayW).toBe(5500)
    expect(s.roofUsedM2).toBe(30)
    expect(s.dailyWh).toBe(20625)
    expect(s.cloudyWh).toBe(8250)
    expect(s.dailyUseWh).toBe(26400)
    expect(s.coverRatio).toBeCloseTo(0.78, 2)
    expect(s.refillHours).toBeCloseTo(4.65, 1)
    expect(s.refillsInOneDay).toBe(true)
    expect(s.strings).toBe(2)
    expect(s.perString).toBe(5)
    expect(s.stringVoc).toBe(248)
    expect(s.chargeA).toBe(95)
    expect(s.controllers).toBe(1)
    expect(s.controllerA).toBe(100)
    expect(s.pvCablePairs).toBe(2)
    expect(s.pvRunM).toBe(20)
    expect(s.breakerA).toBe(40)
    expect(s.isRoofLimited).toBe(false)
  })

  test('a tapped count overrides the recommendation and is clamped to the roof', () => {
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 12 } })!.panels).toBe(12)
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 12 } })!.isRecommended).toBe(false)
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 40 } })!.panels).toBe(13)
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 0 } })!.panels).toBe(0)
  })

  test('a small roof limits the array and says so', () => {
    const s = sizeSolar({ ...base, solar: { ...base.solar, roofM2: 20 } })!
    expect(s.panels).toBe(6)
    expect(s.isRoofLimited).toBe(true)
    expect(s.refillsInOneDay).toBe(false)
    expect(s.refillDays).toBeCloseTo(1.55, 2)
  })

  test('a big array at 48 V needs two controllers and splits the strings', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 100, panels: 24, sunHours: 5 } })!
    expect(s.arrayW).toBe(13200)
    expect(s.chargeA).toBe(229)
    expect(s.controllers).toBe(3)
    expect(s.controllerA).toBe(80)
    expect(s.strings).toBe(5)
    expect(s.breakerA).toBe(40)
  })

  test('at 12 V the same panels push far more current', () => {
    const s = sizeSolar({ ...base, volts: 12, solar: { roofM2: 40, panels: 4, sunHours: 5 } })!
    expect(s.chargeA).toBe(153)
    expect(s.controllers).toBe(2)
    expect(s.controllerA).toBe(80)
  })

  test('no panels gives zero production and no refill time', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 2, panels: null, sunHours: 5 } })!
    expect(s.panels).toBe(0)
    expect(s.dailyWh).toBe(0)
    expect(s.refillHours).toBeNull()
    expect(s.refillDays).toBeNull()
    expect(s.strings).toBe(0)
    expect(s.controllers).toBe(0)
  })

  test('clamps roof and sun hours to their ranges', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 9999, panels: null, sunHours: 99 } })!
    expect(s.roofM2).toBe(SOLAR.ROOF_RANGE[1])
    expect(s.sunHours).toBe(SOLAR.SUN_RANGE[1])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/solar.test.ts`
Expected: FAIL with "Cannot find module './solar'".

- [ ] **Step 3: Write the module**

Create `src/lib/solar.ts`:

```ts
import type { Voltage } from './catalog'

/** Panel, roof and electrical assumptions the solar side of the kit is built on. Shown in the fine print. */
export const SOLAR = {
  PANEL_W: 550,
  PANEL_VOC: 49.6,
  PANEL_ISC: 14,
  PANEL_SIZE: '2.28 × 1.13 m',
  /** Roof per panel including walkways and spacing. */
  M2_PER_PANEL: 3,
  /** Panel to battery: soiling, temperature, wiring and controller losses. */
  SYSTEM_EFF: 0.75,
  CLOUDY_SHARE: 0.4,
  DEFAULT_SUN_HOURS: 4.8,
  SUN_RANGE: [3, 6.5] as const,
  SUN_STEP: 0.5,
  ROOF_RANGE: [5, 500] as const,
  ROOF_STEP: 5,
  MAX_PER_STRING: 5,
  CONTROLLER_MAX_VOC: 450,
  CONTROLLER_AMPS: [30, 40, 60, 80, 100] as const,
  /** Bulk/absorption voltage per bank voltage: what the controller pushes current at. */
  CHARGE_V: { 12: 14.4, 24: 28.8, 36: 43.2, 48: 57.6 } as const satisfies Record<Voltage, number>,
  PV_CABLE: { mm2: 6, awg: '10 AWG' },
  PV_RUN_M: 20,
  BREAKER_MARGIN: 1.25,
  BREAKERS: [16, 20, 25, 32, 40, 63] as const,
} as const

export interface SolarChoice {
  roofM2: number
  /** Tapped count; null means the recommended count. */
  panels: number | null
  sunHours: number
}

export interface SolarInput {
  solar: SolarChoice | null
  bankWh: number
  volts: Voltage
  /** Duty-weighted average draw of the selected load; a day's use is 24 h of it. */
  averageW: number
}

export interface SolarPick {
  roofM2: number
  sunHours: number
  fit: number
  recommended: number
  panels: number
  isRecommended: boolean
  isRoofLimited: boolean
  arrayW: number
  roofUsedM2: number
  dailyWh: number
  cloudyWh: number
  dailyUseWh: number
  coverRatio: number
  /** Hours of peak sun to refill the whole bank from empty; null with no panels. */
  refillHours: number | null
  refillsInOneDay: boolean
  /** Clear days to refill the bank when it takes more than one; null with no panels. */
  refillDays: number | null
  strings: number
  perString: number
  stringVoc: number
  chargeA: number
  controllers: number
  controllerA: number
  pvCablePairs: number
  pvRunM: number
  breakerA: number
}

const HOURS_PER_DAY = 24
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** How many panels a roof holds with walkways. */
export function panelsFit(roofM2: number): number {
  return Math.max(0, Math.floor(roofM2 / SOLAR.M2_PER_PANEL))
}

/** Watt-hours one panel puts into the bank on a clear day. */
const perPanelDayWh = (sunHours: number) => SOLAR.PANEL_W * sunHours * SOLAR.SYSTEM_EFF

/** The fewest panels that refill the whole bank in one clear day. */
export function panelsToRefill(bankWh: number, sunHours: number): number {
  if (bankWh <= 0 || sunHours <= 0) return 0
  return Math.ceil(bankWh / perPanelDayWh(sunHours))
}

export function recommendedPanels(p: { bankWh: number; roofM2: number; sunHours: number }): number {
  return Math.min(panelsFit(p.roofM2), panelsToRefill(p.bankWh, p.sunHours))
}

/** Smallest listed rating at or above `need`; the largest when none is. */
const pickRating = (ratings: readonly number[], need: number) => ratings.find((r) => r >= need) ?? ratings[ratings.length - 1]!

function sizeControllers(arrayW: number, volts: Voltage, strings: number) {
  if (arrayW === 0) return { chargeA: 0, controllers: 0, controllerA: 0, breakerA: 0 }
  const chargeA = Math.round(arrayW / SOLAR.CHARGE_V[volts])
  const maxA = SOLAR.CONTROLLER_AMPS[SOLAR.CONTROLLER_AMPS.length - 1]!
  const controllers = Math.max(1, Math.ceil(chargeA / maxA))
  const controllerA = pickRating(SOLAR.CONTROLLER_AMPS, chargeA / controllers)
  const stringsPerController = Math.ceil(strings / controllers)
  const breakerA = pickRating(SOLAR.BREAKERS, SOLAR.PANEL_ISC * stringsPerController * SOLAR.BREAKER_MARGIN)
  return { chargeA, controllers, controllerA, breakerA }
}

/** The solar side of the kit, or null when the project has no panels. Every input is clamped, never trusted. */
export function sizeSolar(input: SolarInput): SolarPick | null {
  if (!input.solar) return null
  const roofM2 = clamp(finite(input.solar.roofM2, SOLAR.ROOF_RANGE[0]), SOLAR.ROOF_RANGE[0], SOLAR.ROOF_RANGE[1])
  const sunHours = clamp(finite(input.solar.sunHours, SOLAR.DEFAULT_SUN_HOURS), SOLAR.SUN_RANGE[0], SOLAR.SUN_RANGE[1])
  const bankWh = Math.max(0, finite(input.bankWh, 0))
  const fit = panelsFit(roofM2)
  const need = panelsToRefill(bankWh, sunHours)
  const recommended = Math.min(fit, need)
  const tapped = input.solar.panels
  const panels = tapped === null ? recommended : clamp(Math.trunc(finite(tapped, recommended)), 0, fit)

  const arrayW = panels * SOLAR.PANEL_W
  const dailyWh = Math.round(arrayW * sunHours * SOLAR.SYSTEM_EFF)
  const dailyUseWh = Math.round(Math.max(0, finite(input.averageW, 0)) * HOURS_PER_DAY)
  const refillHours = arrayW > 0 ? bankWh / (arrayW * SOLAR.SYSTEM_EFF) : null
  const refillsInOneDay = refillHours !== null && refillHours <= sunHours
  const perString = Math.min(SOLAR.MAX_PER_STRING, panels)
  const strings = perString > 0 ? Math.ceil(panels / perString) : 0
  const electrical = sizeControllers(arrayW, input.volts, strings)

  return {
    roofM2, sunHours, fit, recommended, panels,
    isRecommended: panels === recommended,
    isRoofLimited: fit < need,
    arrayW,
    roofUsedM2: panels * SOLAR.M2_PER_PANEL,
    dailyWh,
    cloudyWh: Math.round(dailyWh * SOLAR.CLOUDY_SHARE),
    dailyUseWh,
    coverRatio: dailyUseWh > 0 ? dailyWh / dailyUseWh : 0,
    refillHours,
    refillsInOneDay,
    refillDays: refillHours === null ? null : refillsInOneDay ? null : bankWh / dailyWh,
    strings, perString,
    stringVoc: Math.round(perString * SOLAR.PANEL_VOC),
    ...electrical,
    pvCablePairs: strings,
    pvRunM: SOLAR.PV_RUN_M,
  }
}
```

- [ ] **Step 4: Run the tests until they pass**

Run: `npx vitest run src/lib/solar.test.ts`
Expected: PASS (11 tests). If a number differs, check the arithmetic in the test comment first; the constants in the decisions table are fixed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar.ts src/lib/solar.test.ts
git commit -m "feat: solar engine with recommended panels, controller and PV wiring sizing"
```

---

### Task 2: `solar` on the project schema and store

**Files:**
- Modify: `src/lib/schema.ts:17-33` (`ProjectSchema`)
- Modify: `src/lib/store.ts:21` (`newProject`), add `setSolar` helpers
- Test: `src/lib/schema.test.ts`, `src/lib/store.test.ts` (exists? if not, create)

**Interfaces:**
- Produces: `SolarSchema`, `Project.solar` (`SolarChoice | null`, default `null`, bad value → `null`), `setSolarIn`, `withSolarPanels`.
- Consumed by: Task 3 (`computeProject`), Task 4 (DB), Task 5 (UI).

- [ ] **Step 1: Write the failing schema tests**

Append to `src/lib/schema.test.ts`:

```ts
const solar = { roofM2: 40, panels: null, sunHours: 4.8 }

test('a project has no solar choice until one is made, and keeps a valid one', () => {
  expect(StoreSchema.parse({ version: 1, projects: [project], currentId: 'p1' }).projects[0]?.solar).toBeNull()
  expect(StoreSchema.parse({ version: 1, projects: [{ ...project, solar }], currentId: 'p1' }).projects[0]?.solar).toEqual(solar)
  expect(StoreSchema.parse({ version: 1, projects: [{ ...project, solar: { ...solar, panels: 12 } }], currentId: 'p1' }).projects[0]?.solar?.panels).toBe(12)
})

test('an unreadable solar choice is dropped instead of losing every saved project', () => {
  const parsed = StoreSchema.safeParse({ version: 1, projects: [{ ...project, solar: { roofM2: 'big' } }], currentId: 'p1' })
  expect(parsed.success).toBe(true)
  expect(parsed.data?.projects[0]?.solar).toBeNull()
})

test('solar values outside their ranges are dropped', () => {
  for (const bad of [{ ...solar, roofM2: 0 }, { ...solar, roofM2: 501 }, { ...solar, sunHours: 2 }, { ...solar, sunHours: 7 }, { ...solar, panels: -1 }, { ...solar, panels: 1.5 }]) {
    expect(StoreSchema.parse({ version: 1, projects: [{ ...project, solar: bad }], currentId: 'p1' }).projects[0]?.solar).toBeNull()
  }
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/schema.test.ts`
Expected: FAIL. `solar` is `undefined`, not `null`.

- [ ] **Step 3: Add the schema**

In `src/lib/schema.ts`, add `import { SOLAR } from './solar'` and, above `ProjectSchema`:

```ts
/** The solar choice from step 3. `panels: null` means the recommended count; the whole object is null for a battery-only kit. */
export const SolarSchema = z.object({
  roofM2: z.number().min(SOLAR.ROOF_RANGE[0]).max(SOLAR.ROOF_RANGE[1]),
  panels: z.number().int().min(0).max(SOLAR.ROOF_RANGE[1] / SOLAR.M2_PER_PANEL).nullable(),
  sunHours: z.number().min(SOLAR.SUN_RANGE[0]).max(SOLAR.SUN_RANGE[1]),
})
```

In `ProjectSchema`, after `batteryUnit`:

```ts
  /** Panels on the roof, or null for a battery-only kit. A copy that no longer parses becomes null, like `requester`. */
  solar: SolarSchema.nullable().default(null).catch(null),
```

And export the type: `export type Solar = z.infer<typeof SolarSchema>`.

- [ ] **Step 4: Run the schema tests**

Run: `npx vitest run src/lib/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store tests**

If `src/lib/store.test.ts` does not exist, create it; otherwise append:

```ts
import { expect, test } from 'vitest'
import { initialStore, currentProject, setSolarIn, withSolarPanels, withSolarRoof, withSolarSun } from './store'
import { SOLAR } from './solar'

test('a new project is battery-only', () => {
  expect(currentProject(initialStore()).solar).toBeNull()
})

test('setSolarIn turns panels on with the defaults and off again', () => {
  const store = initialStore()
  const id = currentProject(store).id
  const on = setSolarIn(store, id, true)
  expect(currentProject(on).solar).toEqual({ roofM2: 40, panels: null, sunHours: SOLAR.DEFAULT_SUN_HOURS })
  expect(currentProject(setSolarIn(on, id, false)).solar).toBeNull()
  expect(setSolarIn(store, 'nope', true)).toBe(store)
})

test('turning panels on again keeps the previous choice', () => {
  const store = initialStore()
  const id = currentProject(store).id
  const tuned = withSolarPanels(setSolarIn(store, id, true), id, 12)
  expect(currentProject(setSolarIn(tuned, id, true)).solar?.panels).toBe(12)
})

test('roof, sun and panels are clamped and snapped to their steps', () => {
  const store = setSolarIn(initialStore(), 'p1', true)
  expect(currentProject(withSolarRoof(store, 'p1', 9999)).solar?.roofM2).toBe(500)
  expect(currentProject(withSolarRoof(store, 'p1', 0)).solar?.roofM2).toBe(5)
  expect(currentProject(withSolarRoof(store, 'p1', 42)).solar?.roofM2).toBe(40)
  expect(currentProject(withSolarSun(store, 'p1', 0)).solar?.sunHours).toBe(3)
  expect(currentProject(withSolarSun(store, 'p1', 5.3)).solar?.sunHours).toBe(5.5)
  expect(currentProject(withSolarPanels(store, 'p1', -3)).solar?.panels).toBe(0)
  expect(currentProject(withSolarPanels(store, 'p1', null)).solar?.panels).toBeNull()
})

test('solar edits on a battery-only project do nothing', () => {
  const store = initialStore()
  expect(withSolarPanels(store, 'p1', 3)).toBe(store)
})
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npx vitest run src/lib/store.test.ts`
Expected: FAIL with "setSolarIn is not exported" (or similar).

- [ ] **Step 7: Add the store helpers**

In `src/lib/store.ts`, import `SOLAR` from `./solar` and `type Solar` from `./schema`. Add `const DEFAULT_ROOF_M2 = 40` next to `DEFAULT_HOURS`. In `newProject`, add `solar: null,` after `batteryUnit: null,`. Append:

```ts
const DEFAULT_SOLAR: Solar = { roofM2: DEFAULT_ROOF_M2, panels: null, sunHours: SOLAR.DEFAULT_SUN_HOURS }

const snap = (n: number, step: number, lo: number, hi: number) => {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n / step) * step))
}

/** Turns panels on (keeping an earlier choice, else the defaults) or off. */
export function setSolarIn(store: Store, id: string, on: boolean): Store {
  const p = store.projects.find((x) => x.id === id)
  if (!p) return store
  return patchProject(store, id, { solar: on ? (p.solar ?? DEFAULT_SOLAR) : null })
}

function patchSolar(store: Store, id: string, patch: Partial<Solar>): Store {
  const p = store.projects.find((x) => x.id === id)
  if (!p?.solar) return store
  return patchProject(store, id, { solar: { ...p.solar, ...patch } })
}

export function withSolarRoof(store: Store, id: string, roofM2: number): Store {
  return patchSolar(store, id, { roofM2: snap(roofM2, SOLAR.ROOF_STEP, SOLAR.ROOF_RANGE[0], SOLAR.ROOF_RANGE[1]) })
}

export function withSolarSun(store: Store, id: string, sunHours: number): Store {
  return patchSolar(store, id, { sunHours: snap(sunHours, SOLAR.SUN_STEP, SOLAR.SUN_RANGE[0], SOLAR.SUN_RANGE[1]) })
}

/** A tapped count, or null to go back to the recommended one. The engine clamps it to the roof. */
export function withSolarPanels(store: Store, id: string, panels: number | null): Store {
  return patchSolar(store, id, { panels: panels === null ? null : Math.max(0, Math.trunc(panels)) })
}
```

Note: `withSolarRoof(…, 42)` snaps to 40 because `Math.round(42 / 5) * 5 = 40`; `withSolarSun(…, 5.3)` snaps to 5.5.

- [ ] **Step 8: Run the store tests and the whole suite**

Run: `npx vitest run src/lib/store.test.ts && npm test`
Expected: PASS. `duplicateProject` copies `solar` by spread already.

- [ ] **Step 9: Commit**

```bash
git add src/lib/schema.ts src/lib/schema.test.ts src/lib/store.ts src/lib/store.test.ts
git commit -m "feat: solar choice on the project with clamped roof, sun and panel edits"
```

---

### Task 3: Wire the engine into `compute`

**Files:**
- Modify: `src/lib/sizing.ts` (`SizingInput`, `SizingResult`, `WarningCode`, `WarningParams`, `compute`)
- Modify: `src/lib/project-summary.ts:16-21` (`computeProject`)
- Test: `src/lib/sizing.test.ts`

**Interfaces:**
- Produces: `SizingInput.solar`, `SizingResult.solar: SolarPick | null`, warning code `roofLimited` with `{ fit, need }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/sizing.test.ts` inside `describe('compute')`:

```ts
  test('has no solar side unless the project chose panels', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.solar).toBeNull()
  })

  test('sizes the solar side from the bank it picked and the average draw', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    // 48 V 200 Ah × 1 = 9,600 Wh bank → 9,600 / (550 × 5 × 0.75) = 4.65 → 5 panels
    expect(r.battery?.bankWh).toBe(9600)
    expect(r.solar?.panels).toBe(5)
    expect(r.solar?.dailyUseWh).toBe(r.averageW * 24)
    expect(r.warnings.some((w) => w.code === 'roofLimited')).toBe(false)
  })

  test('warns when the roof cannot hold the panels that refill the bank', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 6, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(r.solar?.panels).toBe(2)
    expect(r.warnings).toContainEqual({ code: 'roofLimited', params: { fit: 2, need: 5 } })
  })

  test('an empty project with panels sizes nothing and warns nothing', () => {
    const r = compute({ qty: {}, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(r.solar?.panels).toBe(0)
    expect(r.warnings).toEqual([])
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/sizing.test.ts`
Expected: FAIL. `r.solar` is `undefined`.

- [ ] **Step 3: Extend the engine**

In `src/lib/sizing.ts`:

1. Import: `import { sizeSolar, type SolarChoice, type SolarPick } from './solar'`.
2. `SizingInput` gains `solar?: SolarChoice | null` after `batteryUnit`.
3. `WarningCode` gains `| 'roofLimited'`; `WarningParams` gains `fit?: number; need?: number`.
4. `SizingResult` gains `/** The solar side, or null for a battery-only kit. */ solar: SolarPick | null` after `battery`.
5. In `compute`, after `const cable = sizeCable(...)`:

```ts
  const averageW = Math.round(loadWh / hours)
  // An empty project still gets a (smallest) bank from autoPick; panels for it would be nonsense, so size against 0.
  const bankWh = items.length === 0 ? 0 : battery?.bankWh ?? 0
  const solar = sizeSolar({ solar: input.solar ?? null, bankWh, volts, averageW })
  const roofWarning: Warning[] = solar && items.length > 0 && solar.isRoofLimited
    ? [{ code: 'roofLimited', params: { fit: solar.fit, need: panelsToRefill(bankWh, solar.sunHours) } }]
    : []
```

(`panelsToRefill` is imported from `./solar`, so the warning and the engine agree.)

6. In the returned object, use `averageW` instead of recomputing it, add `solar,`, and append `...roofWarning` after `...buildWarnings(...)` and before the `missing` warning.

In `src/lib/project-summary.ts`, `computeProject` passes `solar: p.solar`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/sizing.test.ts && npm run typecheck`
Expected: PASS; typecheck fails only in `src/i18n/*.ts` because `warnings` lacks `roofLimited` (Task 6 adds it). If that is the only error, continue.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sizing.ts src/lib/sizing.test.ts src/lib/project-summary.ts
git commit -m "feat: size the solar side inside compute and warn when the roof is too small"
```

---

### Task 4: Store `solar` with the account (DB column + migration)

**Files:**
- Modify: `src/db/schema.ts` (`projects` table)
- Modify: `src/server/projects.ts` (`toProject`, `upsertAll`)
- Create: `drizzle/0011_project_solar.sql` (+ `drizzle/meta/0011_snapshot.json`, `drizzle/meta/_journal.json`, all generated)
- Test: `src/db/schema.test.ts`

- [ ] **Step 1: Link the env files into the worktree (once)**

Run at the worktree root:

```bash
ln -s ../../../.env.local .env.local && ln -s ../../../.env.test.local .env.test.local
```

Expected: both links exist (`ls -la .env.local .env.test.local`). Skip if they already do.

- [ ] **Step 2: Write the failing test**

In `src/db/schema.test.ts`, change the first test's expected list to:

```ts
  expect(cols).toEqual(['batteryUnit', 'chemistry', 'createdAt', 'custom', 'hours', 'id', 'name', 'qty', 'requester', 'solar', 'updatedAt', 'userId', 'volts'])
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/db/schema.test.ts`
Expected: FAIL. `solar` is missing.

- [ ] **Step 4: Add the column and round-trip it**

In `src/db/schema.ts`, add `import type { Solar } from '../lib/schema'` and, in `projects`, after `requester`:

```ts
    /** Panels on the roof (step 3); null for a battery-only kit. Validated by SolarSchema on read. */
    solar: jsonb('solar').$type<Solar>(),
```

In `src/server/projects.ts`, in `toProject`, add `solar: row.solar,` after `requester: row.requester,`. In `upsertAll`'s `set`, add after `requester`:

```ts
        solar: sql`excluded.solar`,
```

- [ ] **Step 5: Generate the migration (offline, touches no database)**

Run: `npx drizzle-kit generate --name project_solar`
Expected: a new `drizzle/0011_project_solar.sql` containing exactly:

```sql
ALTER TABLE "projects" ADD COLUMN "solar" jsonb;
```

plus an updated `drizzle/meta/_journal.json` and a new `drizzle/meta/0011_snapshot.json`. If the SQL differs, stop and fix the schema; don't hand-edit the SQL.

- [ ] **Step 6: Apply it to the e2e branch only (guarded)**

Run at the worktree root:

```bash
node --input-type=module -e "
import { loadTestEnv } from './e2e/test-env.ts'
loadTestEnv()
const { neon } = await import('@neondatabase/serverless')
const { drizzle } = await import('drizzle-orm/neon-http')
const { migrate } = await import('drizzle-orm/neon-http/migrator')
await migrate(drizzle({ client: neon(process.env.DATABASE_URL) }), { migrationsFolder: './drizzle' })
console.log('e2e branch migrated')
"
```

Expected: `e2e branch migrated`. `loadTestEnv()` throws before any write if `DATABASE_URL` is production. **Do not** run `npm run db:migrate`.

- [ ] **Step 7: Run unit tests**

Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/server/projects.ts src/db/schema.test.ts drizzle/0011_project_solar.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json
git commit -m "feat: solar column on projects, synced with the account"
```

---

### Task 5: Copy in both languages

**Files:**
- Modify: `src/i18n/types.ts` (`UiKey`, `Dictionary.parts`)
- Modify: `src/i18n/en.ts`, `src/i18n/es.ts`
- Test: `src/i18n/i18n.test.ts`

Do this before the UI so every later task compiles. Keys are grouped by where they appear.

- [ ] **Step 1: Write the failing tests**

In `src/i18n/i18n.test.ts`, change the existing `tr` expectation `'Step 2 of 3'` to `'Step 2 of 4'`, and add to `describe('dictionaries')`:

```ts
  test('the roof warning names what fits and what is needed in both languages', () => {
    expect(en.warnings.roofLimited({ fit: 6, need: 10 })).toContain('6')
    expect(en.warnings.roofLimited({ fit: 6, need: 10 })).toContain('10')
    expect(es.warnings.roofLimited({ fit: 6, need: 10 })).toContain('caben 6')
  })
  test('every part the kit can list has a name in both languages', () => {
    const keys = ['inverter', 'batteries', 'mainCable', 'interconnects', 'fuse', 'solarPanels', 'chargeController', 'pvCable', 'pvDisconnect', 'mounting'] as const
    for (const d of [en, es]) for (const k of keys) expect(d.parts[k]).toBeTruthy()
  })
  test('the four steps are named in both languages', () => {
    expect(en.ui.step3).toBe('Solar panels')
    expect(en.ui.step4).toBe('Your kit')
    expect(es.ui.step4).toBe('Tu kit')
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/i18n/i18n.test.ts`
Expected: FAIL (`roofLimited` is not a function; `step4` undefined).

- [ ] **Step 3: Extend the types**

In `src/i18n/types.ts`:

- `parts: Record<'inverter' | 'batteries' | 'mainCable' | 'interconnects' | 'fuse' | 'solarPanels' | 'chargeController' | 'pvCable' | 'pvDisconnect' | 'mounting', string>`
- In `UiKey`, change the first line to `| 'step1' | 'step2' | 'step3' | 'step4' | 'stepOf'` and append:

```ts
  | 'q3' | 'q3Help' | 'solarNo' | 'solarNoHelp' | 'solarYes' | 'solarYesHelp' | 'solarSkipped'
  | 'roofSpace' | 'roofLess' | 'roofMore' | 'roofFits' | 'roofHint' | 'plannerLabel' | 'plannerTile' | 'addPanel' | 'removePanel'
  | 'panelsLine' | 'roofUsed' | 'recommendedPill' | 'backToRecommended' | 'sunHours' | 'sunHint'
  | 'clearDay' | 'flowSun' | 'flowPanels' | 'flowBank' | 'flowHome' | 'coverFull' | 'coverPart' | 'coverAxis'
  | 'refillSameDay' | 'refillDays' | 'noPanelsYet' | 'cloudyDay' | 'cloudyNote' | 'solarAssumptions'
  | 'solarRecharge' | 'solarRechargeSub' | 'nextSolar' | 'footerSolar' | 'footerSolarNone' | 'footer4Solar'
  | 'solarPanelsSpec' | 'solarPanelsNote' | 'chargeControllerSpec' | 'chargeControllerNote' | 'pvCableSpec' | 'pvCableNote'
  | 'pvDisconnectSpec' | 'pvDisconnectNote' | 'mountingSpec' | 'mountingNote' | 'solarTag' | 'fineSolar' | 'sheetPanels'
```

- [ ] **Step 4: English copy**

In `src/i18n/en.ts`:

- Change `step3: 'Your kit'` to `step3: 'Solar panels', step4: 'Your kit'` and `stepOf: 'Step {n} of 4'`.
- Change `next: 'Next: backup window'` to stay, and add after it `nextSolar: 'Next: solar panels'`.
- Append to `ui` (before the closing `}`):

```ts
    q3: 'Do you have roof space for panels?', q3Help: 'Panels refill the bank by day, so an outage that outlasts the window is covered. You can skip this and keep a battery-only kit.',
    solarNo: 'No, batteries only', solarNoHelp: 'The bank refills from the grid or a generator', solarYes: 'Yes, add panels', solarYesHelp: 'Enter your roof space, then adjust the panels',
    solarSkipped: 'Fine. The kit stays as it is. You can come back to this step any time.',
    roofSpace: 'Roof space available', roofLess: 'Five square metres less', roofMore: 'Five square metres more', roofFits: 'Fits {fit} panels with walkways.', roofHint: 'Not sure? Pace it out: one panel is about a door on its side.',
    plannerLabel: 'Roof planner · tap to add or remove', plannerTile: '1 tile = one {w} panel', addPanel: 'Add panel {n}', removePanel: 'Remove panel {n}',
    panelsLine: '{panels} panels · {kw}', roofUsed: 'about {m2} m² of roof', recommendedPill: 'Recommended · refills the bank in a day', backToRecommended: 'Back to recommended · {n}',
    sunHours: 'Peak sun hours a day', sunHint: 'Caracas averages about 4.8 h. Go lower for a roof facing away from the sun or shaded by trees.',
    clearDay: 'On a clear day', flowSun: 'of peak sun', flowPanels: '{panels} panels', flowBank: '{volts} V bank · {batteries}', flowHome: '{count} appliances · {hours} h',
    coverFull: "Covers a full day's use", coverPart: "Covers part of a day's use", coverAxis: "a day's use · {use}",
    refillSameDay: 'Bank full after about {hours} of sun, with {spare} to spare.', refillDays: 'Bank refills over about {days} days of sun.', noPanelsYet: 'No panels yet. Tap the roof.',
    cloudyDay: 'Cloudy day (40%)', cloudyNote: "{wh}, about {pct}% of a day's use.",
    solarAssumptions: 'Assumes 75% efficiency from panel to battery and no shade at midday. Your kit gains panels, an MPPT charge controller, PV cable, a DC disconnect and mounting.',
    solarRecharge: 'Solar recharge', solarRechargeSub: '{wh} a clear day',
    footerSolar: '{hours} h at {volts} V · {load} of load · {panels} panels, {kw}', footerSolarNone: '{hours} h at {volts} V · {load} of load · no panels', footer4Solar: '{batteries} · {inverter} inverter · {gauge} · {panels} panels',
    solarPanelsSpec: '{w} monocrystalline, {size}', solarPanelsNote: '{strings} · {kw} array · about {m2} m² with walkways',
    chargeControllerSpec: 'MPPT {amps} A · {voc} V max PV · {volts} V bank', chargeControllerNote: '{chargeA} A into the bank at full sun · {stringVoc} V open-circuit per string',
    pvCableSpec: '{mm2} mm² ({awg}) solar cable, {length} m each', pvCableNote: 'Roof to controller · one pair per string · MC4 ends',
    pvDisconnectSpec: '{amps} A DC breaker, 500 V', pvDisconnectNote: 'Between the panels and the controller, reachable from the ground',
    mountingSpec: 'Aluminium rails and mid/end clamps for {panels} panels', mountingNote: 'Tilt 10° facing south on a flat roof; flush on a pitched one',
    solarTag: 'Solar', fineSolar: ' Solar assumes {w} panels, 75% panel-to-battery efficiency and {sun} peak sun hours a day.', sheetPanels: '{panels} panels',
    stringsOne: '1 string of {n} in series', stringsMany: '{strings} strings of up to {n} in series',
```

- `stringsOne` and `stringsMany` also go into `UiKey` (append `| 'stringsOne' | 'stringsMany'` to the block in Step 3).
- Add to `warnings`:

```ts
    roofLimited: (p) => `Your roof holds ${p.fit} panels; ${p.need} would refill the bank in one clear day. It still refills over more days of sun.`,
```

- `parts`: add `solarPanels: 'Solar panels', chargeController: 'Charge controller', pvCable: 'PV cable', pvDisconnect: 'PV disconnect', mounting: 'Mounting'`.

- [ ] **Step 5: Spanish copy**

In `src/i18n/es.ts`, the same keys:

```ts
    step3: 'Paneles solares', step4: 'Tu kit', stepOf: 'Paso {n} de 4',
    nextSolar: 'Siguiente: paneles solares',
    q3: '¿Tienes espacio en el techo para paneles?', q3Help: 'Los paneles recargan el banco de día, así que un apagón más largo que las horas de respaldo queda cubierto. Puedes saltarte este paso y quedarte con un kit solo de baterías.',
    solarNo: 'No, solo baterías', solarNoHelp: 'El banco se recarga desde la red o un generador', solarYes: 'Sí, agregar paneles', solarYesHelp: 'Indica el espacio del techo y luego ajusta los paneles',
    solarSkipped: 'Perfecto. El kit queda como está. Puedes volver a este paso cuando quieras.',
    roofSpace: 'Espacio disponible en el techo', roofLess: 'Cinco metros cuadrados menos', roofMore: 'Cinco metros cuadrados más', roofFits: 'Caben {fit} paneles con pasillos.', roofHint: '¿No estás seguro? Mídelo a pasos: un panel es como una puerta acostada.',
    plannerLabel: 'Planificador del techo · toca para agregar o quitar', plannerTile: '1 casilla = un panel de {w}', addPanel: 'Agregar panel {n}', removePanel: 'Quitar panel {n}',
    panelsLine: '{panels} paneles · {kw}', roofUsed: 'unos {m2} m² de techo', recommendedPill: 'Recomendado · recarga el banco en un día', backToRecommended: 'Volver a lo recomendado · {n}',
    sunHours: 'Horas de sol pleno al día', sunHint: 'Caracas promedia unas 4,8 h. Baja el valor si el techo mira lejos del sol o hay árboles que dan sombra.',
    clearDay: 'En un día despejado', flowSun: 'de sol pleno', flowPanels: '{panels} paneles', flowBank: 'banco de {volts} V · {batteries}', flowHome: '{count} aparatos · {hours} h',
    coverFull: 'Cubre el consumo de un día completo', coverPart: 'Cubre parte del consumo de un día', coverAxis: 'consumo de un día · {use}',
    refillSameDay: 'Banco lleno tras unas {hours} de sol, con {spare} de sobra.', refillDays: 'El banco se recarga en unos {days} días de sol.', noPanelsYet: 'Aún no hay paneles. Toca el techo.',
    cloudyDay: 'Día nublado (40%)', cloudyNote: '{wh}, cerca del {pct}% del consumo de un día.',
    solarAssumptions: 'Supone 75% de eficiencia de panel a batería y sin sombra al mediodía. Tu kit suma paneles, un controlador de carga MPPT, cable fotovoltaico, un seccionador de CC y la estructura.',
    solarRecharge: 'Recarga solar', solarRechargeSub: '{wh} en un día despejado',
    footerSolar: '{hours} h a {volts} V · {load} de carga · {panels} paneles, {kw}', footerSolarNone: '{hours} h a {volts} V · {load} de carga · sin paneles', footer4Solar: '{batteries} · inversor de {inverter} · {gauge} · {panels} paneles',
    solarPanelsSpec: '{w} monocristalino, {size}', solarPanelsNote: '{strings} · arreglo de {kw} · unos {m2} m² con pasillos',
    chargeControllerSpec: 'MPPT {amps} A · {voc} V máx. FV · banco de {volts} V', chargeControllerNote: '{chargeA} A hacia el banco a pleno sol · {stringVoc} V en circuito abierto por cadena',
    pvCableSpec: 'Cable solar de {mm2} mm² ({awg}), {length} m cada uno', pvCableNote: 'Del techo al controlador · un par por cadena · terminales MC4',
    pvDisconnectSpec: 'Breaker de CC de {amps} A, 500 V', pvDisconnectNote: 'Entre los paneles y el controlador, accesible desde el suelo',
    mountingSpec: 'Rieles de aluminio y grapas para {panels} paneles', mountingNote: 'Inclinación de 10° hacia el sur en techo plano; a ras en techo inclinado',
    solarTag: 'Solar', fineSolar: ' La parte solar supone paneles de {w}, 75% de eficiencia de panel a batería y {sun} horas de sol pleno al día.', sheetPanels: '{panels} paneles',
    stringsOne: '1 cadena de {n} en serie', stringsMany: '{strings} cadenas de hasta {n} en serie',
```

Warning:

```ts
    roofLimited: (p) => `En tu techo caben ${p.fit} paneles; con ${p.need} el banco se recargaría en un día despejado. Igual se recarga en más días de sol.`,
```

Parts: `solarPanels: 'Paneles solares', chargeController: 'Controlador de carga', pvCable: 'Cable fotovoltaico', pvDisconnect: 'Seccionador FV', mounting: 'Estructura'`.

- [ ] **Step 6: Run the i18n tests and typecheck**

Run: `npx vitest run src/i18n && npm run typecheck`
Expected: PASS; the parity test passes only when en and es have identical key sets. Typecheck passes once `roofLimited` exists in both.

- [ ] **Step 7: Commit**

```bash
git add src/i18n
git commit -m "feat: copy for the solar panels step in English and Spanish"
```

---

### Task 6: Four steps in the wizard shell

**Files:**
- Modify: `src/components/Stepper.tsx`
- Modify: `src/components/WizardFooter.tsx`
- Modify: `src/routes/index.tsx` (`parseStep`, `footerSummary`, the step switch)
- Modify: e2e specs that visit the kit by URL (see Step 4)

- [ ] **Step 1: Stepper**

In `src/components/Stepper.tsx`:

```ts
export type Step = 1 | 2 | 3 | 4

export function Stepper({ step }: { step: Step }) {
  const { t } = useLocale()
  const steps: Step[] = [1, 2, 3, 4]
  const labels: Record<Step, string> = { 1: t.ui.step1, 2: t.ui.step2, 3: t.ui.step3, 4: t.ui.step4 }
```

The rest of the component is unchanged.

- [ ] **Step 2: Footer**

In `src/components/WizardFooter.tsx`, replace the actions block:

```tsx
      <div className="footer__actions">
        {(step === 2 || step === 3) && <button type="button" className="btn" onClick={onBack}>{t.ui.back}</button>}
        {step < 4 && (
          <button type="button" className="btn btn--primary" onClick={onNext}>
            {step === 1 ? t.ui.next : step === 2 ? t.ui.nextSolar : t.ui.buildKit}
          </button>
        )}
        {step === 4 && (
          <button type="button" className="btn footer__download" aria-haspopup="dialog" onClick={onDownload}>
            <Download size={18} aria-hidden="true" />{t.ui.download}
          </button>
        )}
        {step === 4 && <button type="button" className="btn btn--primary" onClick={onStartOver}>{t.ui.startOver}</button>}
      </div>
```

- [ ] **Step 3: Route**

In `src/routes/index.tsx`:

```ts
function parseStep(v: unknown): Step {
  return v === 2 || v === '2' ? 2 : v === 3 || v === '3' ? 3 : v === 4 || v === '4' ? 4 : 1
}

function footerSummary(step: Step, name: string, r: SizingResult, t: Dictionary, locale: Locale): string {
  if (step === 1) return tr(t, 'footer1', { name, count: r.count, running: fmtW(r.runningW, locale), peak: fmtW(r.surgeW, locale) })
  if (step === 2) return tr(t, 'footer2', { hours: r.hours, volts: r.volts, load: fmtKwh(r.loadWh, locale) })
  if (step === 3) {
    const base = { hours: r.hours, volts: r.volts, load: fmtKwh(r.loadWh, locale) }
    return r.solar ? tr(t, 'footerSolar', { ...base, panels: r.solar.panels, kw: fmtW(r.solar.arrayW, locale) }) : tr(t, 'footerSolarNone', base)
  }
  if (r.empty || !r.battery) return t.ui.footerEmpty
  const base = { batteries: batteryCount(t, r.battery.count), inverter: fmtW(r.inverter.w, locale), gauge: r.cable.gauge }
  return r.solar ? tr(t, 'footer4Solar', { ...base, panels: r.solar.panels }) : tr(t, 'footer3', base)
}
```

Note `fmtW(5500)` prints "5,500 W"; the design shows "5.5 kW". Add to `src/i18n/format.ts`:

```ts
/** Watts as kilowatts with one decimal: "5.5 kW", "0.6 kW". For arrays and inverters sized in kW. */
export function fmtKw(w: number, locale: Locale): string {
  return `${(w / 1000).toLocaleString(TAGS[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`
}
```

with a test in `src/i18n/format.test.ts`: `expect(fmtKw(5500, 'en')).toBe('5.5 kW')`, `expect(fmtKw(5500, 'es')).toBe('5,5 kW')`. Use `fmtKw` for `kw` above and everywhere the plan says "kW".

In the step switch, change `{step === 3 && <KitStep …/>}` to `{step === 4 && <KitStep …/>}` and insert, before it:

```tsx
          {step === 3 && (
            <>
              <h2>{t.ui.q3}</h2>
              <SolarStep store={store} commit={commit} project={project} result={result} />
            </>
          )}
```

(`SolarStep` arrives in Task 7; until then leave a `// TODO Task 7` and skip the JSX, or do Tasks 6 and 7 in one branch state before typechecking.) `onBack={() => go((step - 1) as Step)}` and `onNext` already work for four steps.

- [ ] **Step 4: Move every e2e that opens the kit by URL**

Run at the worktree root:

```bash
rg -l "'/\?step=3'" e2e | xargs sed -i '' "s#'/?step=3'#'/?step=4'#g"
```

Expected: `e2e/requester.spec.ts`, `e2e/quote-budget.spec.ts`, `e2e/download.spec.ts`, `e2e/quotes.spec.ts`, `e2e/kit-builder.spec.ts` change. Then in `e2e/kit-builder.spec.ts`:

- `'moving between steps does not wait on the server'`: after clicking `Next: backup window`, click `Next: solar panels`, then expect and click `Build my kit`.
- `'full flow: appliances → window → kit…'`: same insertion.
- `'the battery size can be chosen on the kit…'`: after `/?step=2` and the 12 V click, click `Next: solar panels` then `Build my kit`.
- `'hours, voltage and chemistry change the sizing summary'`: unchanged (stays on step 2).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS once Task 7's `SolarStep` exists; before that, the only error is the missing import.

- [ ] **Step 6: Commit (together with Task 7 if typecheck needs it)**

```bash
git add src/components/Stepper.tsx src/components/WizardFooter.tsx src/routes/index.tsx src/i18n/format.ts src/i18n/format.test.ts e2e
git commit -m "feat: four-step wizard with the kit on step 4"
```

---

### Task 7: The solar step UI

**Files:**
- Create: `src/components/solar/SolarStep.tsx` (question, yes/no tiles, layout)
- Create: `src/components/solar/RoofPlanner.tsx` (roof stepper, tile grid, count line, sun slider)
- Create: `src/components/solar/SolarFlow.tsx` (energy flow strip, coverage bar, clear/cloudy notes)
- Create: `src/styles/solar.css`; add `@import './styles/solar.css';` to `src/styles.css` after `components.css`
- Covered by: Playwright (Task 9). No Vitest for components (no DOM).

Follow the canvas's C boards. Reuse existing classes: `.opt-grid`/`.opt`/`.opt--on` for the yes/no tiles, `.lab`, `.muted`, `.num`, `.note-box`, `.chip`, `input[type=range]`, `.in`. Every control is a real `<button>` or `<input>` with a label; tiles use `aria-pressed`.

- [ ] **Step 1: `SolarStep.tsx`**

```tsx
import { useLocale } from '../../hooks/useLocale'
import type { Project, Store } from '../../lib/schema'
import type { SizingResult } from '../../lib/sizing'
import { setSolarIn, withSolarPanels, withSolarRoof, withSolarSun } from '../../lib/store'
import { RoofPlanner } from './RoofPlanner'
import { SolarFlow } from './SolarFlow'

interface Props { store: Store; commit: (s: Store) => void; project: Project; result: SizingResult }

/** Step 3: panels or not, and if so how many, laid out on the roof. */
export function SolarStep({ store, commit, project, result }: Props) {
  const { t } = useLocale()
  const hasSolar = project.solar !== null
  const id = project.id
  return (
    <div className="solar">
      <p className="muted">{t.ui.q3Help}</p>
      <div className="opt-grid solar__choice">
        <button type="button" className={`opt${hasSolar ? '' : ' opt--on'}`} aria-pressed={!hasSolar} onClick={() => commit(setSolarIn(store, id, false))}>
          <span className="opt__t">{t.ui.solarNo}</span><span className="opt__h">{t.ui.solarNoHelp}</span>
        </button>
        <button type="button" className={`opt${hasSolar ? ' opt--on' : ''}`} aria-pressed={hasSolar} onClick={() => commit(setSolarIn(store, id, true))}>
          <span className="opt__t">{t.ui.solarYes}</span><span className="opt__h">{t.ui.solarYesHelp}</span>
        </button>
      </div>
      {!hasSolar && <div className="note-box solar__skipped">{t.ui.solarSkipped}</div>}
      {hasSolar && result.solar && project.solar && (
        <div className="solar__cols">
          <RoofPlanner
            solar={result.solar}
            onRoof={(m2) => commit(withSolarRoof(store, id, m2))}
            onPanels={(n) => commit(withSolarPanels(store, id, n))}
            onSun={(h) => commit(withSolarSun(store, id, h))}
          />
          <SolarFlow result={result} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `RoofPlanner.tsx`**

```tsx
import { useId } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { tr } from '../../i18n'
import { fmtDecimal, fmtKw } from '../../i18n/format'
import { SOLAR, type SolarPick } from '../../lib/solar'

interface Props {
  solar: SolarPick
  onRoof: (m2: number) => void
  onPanels: (n: number | null) => void
  onSun: (hours: number) => void
}

/** Roof area in, tiles out: one tile per panel the roof holds, the recommended ones pre-filled, tap to override. */
export function RoofPlanner({ solar: s, onRoof, onPanels, onSun }: Props) {
  const { t, locale } = useLocale()
  const roofId = useId()
  const sunId = useId()
  const tiles = Array.from({ length: s.fit }, (_, i) => i)
  return (
    <div className="planner">
      <div className="planner__roof">
        <label className="lab" htmlFor={roofId}>{t.ui.roofSpace}</label>
        <div className="planner__stepper">
          <button type="button" className="planner__step" aria-label={t.ui.roofLess} disabled={s.roofM2 <= SOLAR.ROOF_RANGE[0]} onClick={() => onRoof(s.roofM2 - SOLAR.ROOF_STEP)}>−</button>
          <output id={roofId} className="in num planner__roof-value" aria-live="polite">{`${s.roofM2} m²`}</output>
          <button type="button" className="planner__step" aria-label={t.ui.roofMore} disabled={s.roofM2 >= SOLAR.ROOF_RANGE[1]} onClick={() => onRoof(s.roofM2 + SOLAR.ROOF_STEP)}>+</button>
          <span className="muted planner__fits">{tr(t, 'roofFits', { fit: s.fit })} {t.ui.roofHint}</span>
        </div>
      </div>
      <div className="planner__head">
        <span className="lab">{t.ui.plannerLabel}</span>
        <span className="muted num">{tr(t, 'plannerTile', { w: `${SOLAR.PANEL_W} W` })}</span>
      </div>
      <div className="planner__grid" role="group" aria-label={t.ui.plannerLabel}>
        {tiles.map((i) => {
          const on = i < s.panels
          return (
            <button key={i} type="button" className={`tile${on ? ' tile--on' : ''}`} aria-pressed={on}
              aria-label={tr(t, on ? 'removePanel' : 'addPanel', { n: i + 1 })} onClick={() => onPanels(on ? i : i + 1)} />
          )
        })}
      </div>
      <div className="planner__count">
        <span className="num planner__big">{tr(t, 'panelsLine', { panels: s.panels, kw: fmtKw(s.arrayW, locale) })}</span>
        {s.isRecommended
          ? <span className="planner__pill">{t.ui.recommendedPill}</span>
          : <button type="button" className="chip" onClick={() => onPanels(null)}>{tr(t, 'backToRecommended', { n: s.recommended })}</button>}
      </div>
      <div className="planner__sun">
        <div className="planner__sun-head">
          <label htmlFor={sunId}>{t.ui.sunHours}</label>
          <span className="num planner__sun-value">{`${fmtDecimal(s.sunHours, 1, locale)} h`}</span>
        </div>
        <input id={sunId} type="range" min={SOLAR.SUN_RANGE[0]} max={SOLAR.SUN_RANGE[1]} step={SOLAR.SUN_STEP} value={s.sunHours} onChange={(e) => onSun(Number(e.target.value))} />
        <span className="muted planner__hint">{t.ui.sunHint}</span>
      </div>
    </div>
  )
}
```

Tapping tile `i` when it is on sets `panels = i` (removes it and everything after); when off, `panels = i + 1`. That matches the canvas.

- [ ] **Step 3: `SolarFlow.tsx`**

```tsx
import { Battery, Home, Sun } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import { batteryCount, tr } from '../../i18n'
import { fmtDecimal, fmtHours, fmtKw, fmtKwh } from '../../i18n/format'
import type { SizingResult } from '../../lib/sizing'

const AXIS_MIN_WH = 26_400
const AXIS_STEP_WH = 2_000
const PERCENT = 100

interface Props { result: SizingResult }

/** Sun → panels → bank → home on a clear day, and how much of a day's use the array covers. */
export function SolarFlow({ result: r }: Props) {
  const { t, locale } = useLocale()
  const s = r.solar
  if (!s || !r.battery) return null
  const axisWh = Math.max(AXIS_MIN_WH, Math.ceil(s.dailyWh / AXIS_STEP_WH) * AXIS_STEP_WH)
  const pct = (wh: number) => `${Math.min(PERCENT, Math.round((wh / axisWh) * PERCENT))}%`
  const clearNote = s.panels === 0
    ? t.ui.noPanelsYet
    : s.refillsInOneDay && s.refillHours !== null
      ? tr(t, 'refillSameDay', { hours: fmtHours(s.refillHours, locale), spare: fmtKwh(Math.max(0, s.dailyWh - s.dailyUseWh), locale) })
      : tr(t, 'refillDays', { days: fmtDecimal(s.refillDays ?? 0, 1, locale) })
  return (
    <div className="flow">
      <div className="lab">{t.ui.clearDay}</div>
      <div className="flow__strip">
        <div className="flow__node flow__node--sun"><Sun size={26} aria-hidden="true" /><span className="num flow__v">{`${fmtDecimal(s.sunHours, 1, locale)} h`}</span><span className="flow__s">{t.ui.flowSun}</span></div>
        <div className="flow__arrow" aria-hidden="true" />
        <div className="flow__node"><span className="flow__panel" aria-hidden="true" /><span className="num flow__v">{fmtKw(s.arrayW, locale)}</span><span className="flow__s num">{tr(t, 'flowPanels', { panels: s.panels })}</span></div>
        <div className="flow__arrow" aria-hidden="true"><span className="num flow__arrow-t">{fmtKwh(s.dailyWh, locale)}</span></div>
        <div className="flow__node flow__node--bank"><Battery size={26} aria-hidden="true" /><span className="num flow__v">{fmtKwh(r.battery.bankWh, locale)}</span><span className="flow__s">{tr(t, 'flowBank', { volts: r.volts, batteries: batteryCount(t, r.battery.count) })}</span></div>
        <div className="flow__arrow flow__arrow--ink" aria-hidden="true"><span className="num flow__arrow-t">{fmtKwh(s.dailyUseWh, locale)}</span></div>
        <div className="flow__node"><Home size={26} aria-hidden="true" /><span className="num flow__v">{`${r.runningW.toLocaleString(locale === 'es' ? 'es-419' : 'en-US')} W`}</span><span className="flow__s num">{tr(t, 'flowHome', { count: r.count, hours: r.hours })}</span></div>
      </div>
      <div className="cover">
        <div className="cover__head">
          <strong>{s.coverRatio >= 1 ? t.ui.coverFull : t.ui.coverPart}</strong>
          <span className="num cover__pct">{`${Math.round(s.coverRatio * PERCENT)}%`}</span>
        </div>
        <div className="cover__bar"><div className="cover__fill" style={{ width: pct(s.dailyWh) }} /><div className="cover__mark" style={{ left: pct(s.dailyUseWh) }} aria-hidden="true" /></div>
        <div className="muted cover__axis"><span>0</span><span className="num">{tr(t, 'coverAxis', { use: fmtKwh(s.dailyUseWh, locale) })}</span><span className="num">{fmtKwh(axisWh, locale)}</span></div>
        <div className="cover__notes">
          <div className="note-box note-box--sun"><strong>{t.ui.clearDay}</strong><br />{clearNote}</div>
          <div className="note-box"><strong>{t.ui.cloudyDay}</strong><br />{s.panels === 0 ? '—' : tr(t, 'cloudyNote', { wh: fmtKwh(s.cloudyWh, locale), pct: Math.round(s.coverRatio * PERCENT * 0.4) })}</div>
        </div>
      </div>
      <p className="fine muted">{t.ui.solarAssumptions}</p>
    </div>
  )
}
```

Replace the inline `toLocaleString` for running watts with `fmtW(r.runningW, locale)` from `../../i18n/format` (it exists). The `0.4` is `SOLAR.CLOUDY_SHARE`; import it.

- [ ] **Step 4: `solar.css`**

Create `src/styles/solar.css` with the tokens already in `tokens.css` plus two solar ones added at the top of `tokens.css` (`--sun-tint: #FFF8E1; --sun-line: #EBCB6A; --sun-ink: #7A5200; --panel: #1C2B4A; --panel-line: #2E4370;`):

```css
/* Step 3: panels or not, roof planner and the clear-day flow. Phones stack the two columns. */
.solar { display: flex; flex-direction: column; gap: 14px; }
.solar__choice { max-width: 640px; }
.solar__skipped { max-width: 640px; }
.solar__cols { display: flex; flex-direction: column; gap: 20px; }
.planner { display: flex; flex-direction: column; gap: 14px; }
.planner__roof { display: flex; flex-direction: column; gap: 6px; }
.planner__stepper { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.planner__step { width: var(--tap); height: var(--tap); border-radius: var(--radius-sm); border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 20px; font-weight: 600; flex-shrink: 0; }
.planner__step:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.planner__step:disabled { color: var(--faint); }
.planner__roof-value { width: auto; min-width: 120px; text-align: center; font-weight: 700; font-size: 18px; line-height: var(--tap); }
.planner__fits { font-size: 13px; flex: 1 1 100%; }
.planner__head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 12px; }
.planner__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); }
.tile { aspect-ratio: 1.13 / 2.28; min-height: var(--tap); border-radius: 6px; border: 1.5px dashed var(--line-strong); background: var(--ground); padding: 0; transition: background 120ms, border-color 120ms; }
.tile:hover { border-color: var(--accent); }
.tile--on { border: 1.5px solid #0F1A33; background: var(--panel); background-image: linear-gradient(var(--panel-line) 1px, transparent 1px), linear-gradient(90deg, var(--panel-line) 1px, transparent 1px); background-size: 100% 25%, 50% 100%; }
.tile--on:hover { box-shadow: 0 0 0 3px var(--accent-ring); }
.tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.planner__count { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.planner__big { font-family: var(--font-display); font-size: 24px; font-weight: 700; }
.planner__pill { font-size: 13px; font-weight: 600; color: var(--success); background: var(--success-tint); border-radius: 999px; padding: 6px 12px; }
.planner__sun { display: flex; flex-direction: column; gap: 4px; }
.planner__sun-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; font-weight: 600; }
.planner__sun-value { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--accent); }
.planner__hint { font-size: 12px; }
.flow { display: flex; flex-direction: column; gap: 14px; }
.flow__strip { display: grid; grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr) 24px minmax(0, 1fr) 24px minmax(0, 1fr); gap: 4px; align-items: center; }
.flow__node { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; padding: 10px 6px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); min-width: 0; }
.flow__node--sun { background: var(--sun-tint); border-color: var(--sun-line); color: var(--sun-ink); }
.flow__node--bank { background: var(--accent-tint); border-color: #C9D3FF; color: var(--accent); }
.flow__v { font-family: var(--font-display); font-size: 15px; font-weight: 700; line-height: 1.1; }
.flow__s { font-size: 11px; color: var(--muted); }
.flow__panel { width: 34px; height: 22px; border-radius: 4px; background: var(--panel); background-image: linear-gradient(var(--panel-line) 1px, transparent 1px), linear-gradient(90deg, var(--panel-line) 1px, transparent 1px); background-size: 100% 50%, 33.4% 100%; }
.flow__arrow { position: relative; height: 3px; border-radius: 2px; background: #E0A800; }
.flow__arrow::after { content: ''; position: absolute; right: -2px; top: -5px; border-left: 9px solid #E0A800; border-top: 6.5px solid transparent; border-bottom: 6.5px solid transparent; }
.flow__arrow--ink { background: var(--accent); }
.flow__arrow--ink::after { border-left-color: var(--accent); }
.flow__arrow-t { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: 700; color: var(--sun-ink); white-space: nowrap; }
.cover { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); }
.cover__head { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; }
.cover__pct { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--sun-ink); }
.cover__bar { position: relative; height: 12px; border-radius: 999px; background: var(--fill); overflow: visible; }
.cover__fill { height: 100%; border-radius: 999px; background: #E0A800; }
.cover__mark { position: absolute; top: -4px; width: 2px; height: 20px; background: var(--ink); }
.cover__axis { display: flex; justify-content: space-between; font-size: 11px; }
.cover__notes { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 4px; }
.note-box--sun { background: var(--sun-tint); color: var(--sun-ink); }
@media (min-width: 1024px) {
  .solar__cols { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 40px; align-items: start; }
  .flow__strip { grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr) 64px minmax(0, 1fr) 64px minmax(0, 1fr); gap: 8px; }
  .flow__node { padding: 14px 10px; border-radius: 14px; }
  .flow__v { font-size: 20px; }
  .flow__s { font-size: 12px; }
  .cover__notes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .planner__fits { flex: 1; }
}
```

`#E0A800` on white is decorative (bar fill, arrows); text on it never appears. `--sun-ink` on `--sun-tint` is 7.9:1.

- [ ] **Step 5: Import the stylesheet and the component**

Add `@import './styles/solar.css';` to `src/styles.css` after `components.css`. In `src/routes/index.tsx`, `import { SolarStep } from '../components/solar/SolarStep'` and use the JSX from Task 6 Step 3.

- [ ] **Step 6: Typecheck and look at it**

Run: `npm run typecheck`
Expected: PASS.

Then open the dev server (preview tool, `dev` config) at `/?step=3`. The Home project has a 9.6 kWh bank (one 48 V 200 Ah), so at 4.8 h the recommendation is 5 panels: "No, batteries only" is selected on a fresh project; tapping "Yes, add panels" shows 13 tiles with 5 filled and the Recommended pill; tapping tile 8 fills 8 and swaps the pill for "Back to recommended · 5"; roof "−" four times to 20 m² shows 6 tiles with 5 filled; the footer reads "10 h at 48 V · 3.7 kWh of load · 5 panels, 2.8 kW". Check the phone preset (390 px): the columns stack, tiles stay ≥ 44 px tall.

- [ ] **Step 7: Commit**

```bash
git add src/components/solar src/styles/solar.css src/styles/tokens.css src/styles.css src/routes/index.tsx
git commit -m "feat: solar panels step with roof planner and clear-day flow"
```

---

### Task 8: The kit shows the solar side (tile, parts, sheet, CSV)

**Files:**
- Modify: `src/components/KitSummary.tsx` (`buildParts`, `Part`, `PartsTable`, stats)
- Modify: `src/components/KitSheet.tsx` (subtitle, fine print)
- Modify: `src/styles/components.css` (`.stat--sun`, `.part__tag`, 5-tile stats on desktop)
- Test: `src/lib/kit-parts.test.ts`

The PDF/PNG sheet and the CSV read `buildParts`, so adding rows there reaches every export. `KitNeeds` for quotes is untouched.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/kit-parts.test.ts` inside the `describe.each`:

```ts
  test('a battery-only kit has no solar rows', () => {
    const parts = buildParts(result('48-200'), t, locale)
    expect(parts.some((p) => p.group === 'solar')).toBe(false)
  })

  test('panels add five tagged rows after the fuse, in order', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 40, panels: 10, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const parts = buildParts(r, t, locale)
    expect(parts.map((p) => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'fuse', 'solarPanels', 'chargeController', 'pvCable', 'pvDisconnect', 'mounting'])
    expect(parts.filter((p) => p.group === 'solar')).toHaveLength(5)
    const panels = parts.find((p) => p.id === 'solarPanels')!
    expect(panels.qty).toBe('10')
    expect(panels.spec).toBe(locale === 'es' ? '550 W monocristalino, 2.28 × 1.13 m' : '550 W monocrystalline, 2.28 × 1.13 m')
    expect(panels.note).toContain(locale === 'es' ? '2 cadenas de hasta 5 en serie' : '2 strings of up to 5 in series')
    expect(parts.find((p) => p.id === 'chargeController')!.qty).toBe('1')
    expect(parts.find((p) => p.id === 'chargeController')!.spec).toContain('MPPT 100 A')
    expect(parts.find((p) => p.id === 'pvCable')!.qty).toBe('2')
    expect(parts.find((p) => p.id === 'pvDisconnect')!.spec).toContain('40 A')
  })

  test('zero panels adds no solar rows even with the step turned on', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 2, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(buildParts(r, t, locale).some((p) => p.group === 'solar')).toBe(false)
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/kit-parts.test.ts`
Expected: FAIL (`group` undefined, 4 ids instead of 9).

- [ ] **Step 3: Extend `buildParts`**

In `src/components/KitSummary.tsx`:

```ts
export interface Part { id: string; name: string; spec: string; note: string; qty: string; group?: 'solar' }

function solarParts(r: SizingResult, t: Dictionary, locale: Locale): Part[] {
  const s = r.solar
  if (!s || s.panels === 0) return []
  const strings = s.strings === 1 ? tr(t, 'stringsOne', { n: s.perString }) : tr(t, 'stringsMany', { strings: s.strings, n: s.perString })
  const panelW = `${SOLAR.PANEL_W} W`
  return [
    { id: 'solarPanels', group: 'solar', name: t.parts.solarPanels, spec: tr(t, 'solarPanelsSpec', { w: panelW, size: SOLAR.PANEL_SIZE }), note: tr(t, 'solarPanelsNote', { strings, kw: fmtKw(s.arrayW, locale), m2: s.roofUsedM2 }), qty: String(s.panels) },
    { id: 'chargeController', group: 'solar', name: t.parts.chargeController, spec: tr(t, 'chargeControllerSpec', { amps: s.controllerA, voc: SOLAR.CONTROLLER_MAX_VOC, volts: r.volts }), note: tr(t, 'chargeControllerNote', { chargeA: fmtInt(s.chargeA, locale), stringVoc: s.stringVoc }), qty: String(s.controllers) },
    { id: 'pvCable', group: 'solar', name: t.parts.pvCable, spec: tr(t, 'pvCableSpec', { mm2: SOLAR.PV_CABLE.mm2, awg: SOLAR.PV_CABLE.awg, length: s.pvRunM }), note: t.ui.pvCableNote, qty: String(s.pvCablePairs) },
    { id: 'pvDisconnect', group: 'solar', name: t.parts.pvDisconnect, spec: tr(t, 'pvDisconnectSpec', { amps: s.breakerA }), note: t.ui.pvDisconnectNote, qty: String(s.controllers) },
    { id: 'mounting', group: 'solar', name: t.parts.mounting, spec: tr(t, 'mountingSpec', { panels: s.panels }), note: t.ui.mountingNote, qty: '1' },
  ]
}
```

Import `SOLAR` from `../lib/solar` and `fmtKw` from `../i18n/format`. In `buildParts`, change the return to `return [...base.filter((part) => Number(part.qty) > 0), ...solarParts(r, t, locale)]` where `base` is the existing array.

In `PartsTable`, inside the row header: `{pt.name}{pt.group === 'solar' && <span className="part__tag">{t.ui.solarTag}</span>}`.

- [ ] **Step 4: The fifth stat tile**

In `KitSummary`, after the runtime `stat--accent` tile:

```tsx
        {r.solar && r.solar.panels > 0 && (
          <div className="stat stat--sun">
            <div className="lab">{t.ui.solarRecharge}</div>
            <div className="stat__row"><span className="stat__v num">{fmtKw(r.solar.arrayW, locale)}</span></div>
            <div className="stat__sub num">{tr(t, 'solarRechargeSub', { wh: fmtKwh(r.solar.dailyWh, locale) })}</div>
          </div>
        )}
```

And the fine print: `{tr(t, 'fine', { dod })}{r.solar && r.solar.panels > 0 ? tr(t, 'fineSolar', { w: `${SOLAR.PANEL_W} W`, sun: fmtDecimal(r.solar.sunHours, 1, locale) }) : ''}`.

In `src/styles/components.css` next to `.stat--accent`:

```css
.stat--sun { background: var(--sun-tint); border-color: var(--sun-line); }
.stat--sun .lab, .stat--sun .stat__v { color: var(--sun-ink); }
.stats--five { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.stats--five .stat--sun { grid-column: span 2; }
.part__tag { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: var(--sun-tint); color: var(--sun-ink); border: 1px solid var(--sun-line); margin-left: 6px; vertical-align: middle; }
@media (min-width: 1024px) { .stats--five { grid-template-columns: repeat(5, minmax(0, 1fr)); } .stats--five .stat--sun { grid-column: auto; } }
```

Give the stats grid `className={`stats${hasSolar ? ' stats--five' : ''}`}`. Check how `.stats` already behaves at ≥ 1024 px (it may already be 4 columns there) and keep that rule for the four-tile case.

- [ ] **Step 5: The sheet**

In `src/components/KitSheet.tsx`, the subtitle gains the panels: `` `${r.volts} V ${t.chemistries[r.chemistry]} · ${tr(t, 'hoursShort', { hours: r.hours })}${r.solar && r.solar.panels > 0 ? ` · ${tr(t, 'sheetPanels', { panels: r.solar.panels })}` : ''}` ``. The fine print line gets the same `fineSolar` suffix as `KitSummary`. The parts table already lists the solar rows; no `part__tag` on the sheet (print stays plain).

- [ ] **Step 6: Run the tests, typecheck, and look at the kit**

Run: `npm test && npm run typecheck`
Expected: PASS.

Open `/?step=4` on the Home project after choosing panels in step 3: five stat tiles, five Solar-tagged rows, the footer "1 battery · 3,000 W inverter · 8 AWG · 5 panels". Open the Download tab: the preview's parts table shows the solar rows and the subtitle ends in "5 panels".

- [ ] **Step 7: Commit**

```bash
git add src/components/KitSummary.tsx src/components/KitSheet.tsx src/styles/components.css src/lib/kit-parts.test.ts
git commit -m "feat: solar recharge tile and solar parts on the kit, the sheet and the CSV"
```

---

### Task 9: End-to-end coverage

**Files:**
- Create: `e2e/solar.spec.ts`
- Modify: `e2e/download.spec.ts` (one CSV assertion)

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test'
import { switchLanguage } from './header'

test('a fresh project is battery-only and the step can be skipped', async ({ page }) => {
  await page.goto('/?step=3')
  await expect(page.getByRole('heading', { name: 'Do you have roof space for panels?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^No, batteries only/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: /Roof planner/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: /Solar panels/ })).toHaveCount(0)
})

test('the roof area fills the planner with the recommended panels, taps override it, and it survives a reload', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  const planner = page.getByRole('group', { name: /Roof planner/ })
  // Home: 48 V 200 Ah = 9.6 kWh bank, 4.8 h → 5 panels; 40 m² holds 13.
  await expect(planner.getByRole('button')).toHaveCount(13)
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(5)
  await expect(page.getByText('Recommended · refills the bank in a day')).toBeVisible()
  await expect(page.getByText(/^5 panels · 2\.8 kW$/)).toBeVisible()

  await planner.getByRole('button', { name: 'Add panel 8' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Back to recommended · 5' })).toBeVisible()
  await planner.getByRole('button', { name: 'Remove panel 3' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(2)

  await page.getByRole('button', { name: 'Five square metres less' }).click()
  await page.getByRole('button', { name: 'Five square metres less' }).click()
  await expect(planner.getByRole('button')).toHaveCount(10)
  await page.getByRole('button', { name: 'Back to recommended · 5' }).click()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(5)

  await page.reload()
  await expect(planner.getByRole('button', { pressed: true })).toHaveCount(5)
  await expect(page.getByText('30 m²')).toBeVisible()
})

test('a small roof shows fewer tiles and the kit warns about it', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  const less = page.getByRole('button', { name: 'Five square metres less' })
  for (let i = 0; i < 6; i++) await less.click()
  await expect(page.getByText('10 m²')).toBeVisible()
  await expect(page.getByRole('group', { name: /Roof planner/ }).getByRole('button')).toHaveCount(3)
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('status')).toContainText('Your roof holds 3 panels')
})

test('sun hours change the recommendation and the flow', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  await page.getByLabel('Peak sun hours a day').fill('3')
  await expect(page.getByRole('group', { name: /Roof planner/ }).getByRole('button', { pressed: true })).toHaveCount(8)
  await expect(page.getByText(/^8 panels · 4\.4 kW$/)).toBeVisible()
})

test('the kit lists the solar parts and the CSV carries them', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByText('Solar recharge')).toBeVisible()
  await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Solar panels/ }) })).toContainText('×5')
  await expect(page.getByRole('rowheader', { name: /Charge controller/ })).toBeVisible()
  await expect(page.getByText(/· 5 panels$/)).toBeVisible()
})

test('the step reads in Spanish', async ({ page }) => {
  await page.goto('/?step=3')
  await switchLanguage(page, 'Español')
  await expect(page.getByRole('heading', { name: '¿Tienes espacio en el techo para paneles?' })).toBeVisible()
  await page.getByRole('button', { name: /^Sí, agregar paneles/ }).click()
  await expect(page.getByText('Recomendado · recarga el banco en un día')).toBeVisible()
  await switchLanguage(page, 'English')
})
```

Numbers to verify when writing: Home's bank is one 48 V 200 Ah (9,600 Wh) per `sizing.test.ts`; at 4.8 h, `panelsToRefill` = ceil(9600 / 1980) = 5; 5 × 550 = 2,750 W → "2.8 kW"; at 3 h, ceil(9600 / 1237.5) = 8 → "4.4 kW". The `/?step=3` roof-warning test: 10 m² holds 3 panels, need 5 → warning. If the `range` input does not accept `fill`, use `page.getByLabel(...).focus()` then `keyboard.press('ArrowLeft')` four times (0.5 per press, from 4.8 to 3: 4.8 → 4.5 → 4 → 3.5 → 3).

In `e2e/download.spec.ts`, inside the CSV test, after `text` is read: choose panels first (`/?step=3`, click Yes, Build my kit) in a new test or extend the existing one with `expect(text).toContain('Solar panels')` once panels are on. Keep the original battery-only assertions intact.

- [ ] **Step 2: Run the whole e2e suite**

Run: `npm run e2e`
Expected: PASS on both projects (desktop and phone). Watch the renamed `/?step=4` specs in `requester.spec.ts`, `quotes.spec.ts`, `quote-budget.spec.ts` and `download.spec.ts`.

- [ ] **Step 3: Coverage**

Run: `npm run test:coverage`
Expected: every threshold ≥ 80%.

- [ ] **Step 4: Commit**

```bash
git add e2e/solar.spec.ts e2e/download.spec.ts
git commit -m "test: e2e for the solar panels step and the solar parts in exports"
```

---

### Task 10: Review and hand-off

- [ ] Run `npm test && npm run typecheck && npm run e2e` once more from a clean tree.
- [ ] Use the **code-reviewer** agent on `git diff main...HEAD`; fix CRITICAL and HIGH findings.
- [ ] Read the Review Focus list at the top and confirm each item has a passing test.
- [ ] Report what was built with a screenshot of step 3 (desktop and phone) and of the kit with the solar tile. Stop there: pushing, the PR and the production migration (it runs on Vercel's build) wait for the user's OK.

## Implementation notes (what changed while building this)

- **Engine:** each charge controller needs its own string, so `sizeSolar` sets `strings = max(ceil(panels / 5), controllers)`; at 12 V four panels give two strings of two. The decisions table above was updated.
- **Tests that could not pass as written:** `roofM2: 2` clamps to the 5 m² minimum, which fits one panel. The Task 1 "no panels" test uses `bankWh: 0`; the Task 8 "zero panels" test uses `panels: 0`. `fmtKw(5500, 'es')` is `'5.5 kW'` (es-419 uses a dot).
- **Step rename misses:** `src/components/quotes/VerdictView.tsx` (back-to-kit link) and `e2e/quotes.ts` (template-literal URL) also moved to step 4.
- **Copy:** panel counts are pluralised through `panelCount` (`panelCountOne`/`panelCountMany`, `roofFitsOne`/`roofFitsMany`); `flowPanels`, `sheetPanels` and `roofUsed` were dropped. A roof-limited project shows `recommendedPillLimited` ("the most your roof fits") instead of promising a one-day refill. Mounting faces south (Caracas is at 10.5° N).
- **One guard:** `hasPanels(r)` in `src/lib/sizing.ts` (`solar` present, panels > 0, project not empty) gates the tile, the parts rows and the fine print on the kit and the sheet.
- **e2e:** the Review Focus items (2) and (3) are exercised by shrinking a roof below a tapped count and by changing sun hours after a tap; the CSV test also checks row order.
- **Follow-ups (not done):** cap `withSolarPanels` at the schema max and guard NaN; move `DEFAULT_ROOF_M2` into `SOLAR`; a pure `toProject` round-trip test; an e2e for the verdict back-to-kit link; pass `{pct}` from `SOLAR.CLOUDY_SHARE` into `cloudyDay`; row-anchored CSV order checks; unit tests for `finePrint`.

## Out of scope (say so in the hand-off)

- Quote verdict checks for panels or controllers (`kitNeeds`, `quote-items.ts`).
- Panels on project cards or in the kit's quick edit bar.
- Orientation, tilt or shade modelling; the sun-hours slider is the only knob.
- A city picker for sun hours (variant B had one; C uses the slider).
