# Appliance catalog in Postgres: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the appliance catalog from a Postgres table so appliances can be added or corrected without a redeploy. Writes go through a token-protected REST API (used by a `/research-appliance` Claude Code skill) and a small admin page.

**Architecture:** The sizing engine stops importing a static list and receives the catalog as an argument. A `getCatalog` server function reads the `appliances` table through a 60 s in-memory cache, falls back to a bundled snapshot on error, and the cached root loader hands the catalog to the client. One repository module is the only write path; the REST routes and the admin server functions both call it.

**Tech Stack:** TanStack Start (file routes, `createServerFn`, server route handlers), Drizzle ORM + drizzle-kit on Neon (`neon-http`), Zod 4, Better Auth sessions, Vitest, Playwright.

Spec: `docs/superpowers/specs/2026-09-26-appliance-catalog-db-design.md`

## Global Constraints

- **Ids never change.** Seed rows reuse today's ids (`fridge`, `ac1i`, `ac15c`, …). Id format: `^[a-z0-9][a-z0-9-]{1,47}$`.
- **`duty` and `tons` columns are `double precision`, never `real`.** `real` rounds 0.35 to 0.3499999940… and would shift the engine's numbers.
- The engine's existing test expectations must not change. Only the way the catalog is passed in changes. The one exception is Task 9's new `splitPhase` warning; the existing warning-list assertions use light loads and should be unaffected.
- **Seeding uses two migrations**: `0003` (table, generated) and `0004_seed_appliances` (custom SQL). The spec says one migration; two keeps drizzle-kit's generated file untouched.
- Better Auth has `cookieCache` on (5 min). After flipping `email_verified`, the user must sign out and in again before the admin check sees it.
- **Categories stay a TypeScript union.** `APPLIANCE_CATEGORIES = ['Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal']`, which is `CATEGORIES` without `Custom`.
- Watts range 1–30 000, `surge ≥ watts`, `0 < duty ≤ 1`. `tons` and `acType` are set only when the category is `Air conditioning`, and must be set then.
- Cache TTL 60 000 ms. Split-phase note threshold `3000` W.
- **API auth.** Header `Authorization: Bearer <token>`. `CATALOG_API_TOKEN` must be at least 32 characters, otherwise every catalog API route returns 404. Compare SHA-256 digests with `timingSafeEqual`. Throttle 10 failures per IP per 10 minutes. Writes record `updated_by = 'api-token'`.
- **Admin.** A user is an admin only if `user.emailVerified === true` **and** their email is in `ADMIN_EMAILS` (comma-separated, case-insensitive). This tightens the spec: without the verified-email check, anyone could sign up with the admin's address before the admin does. Everyone else gets 404.
- The admin page is English-only (internal tool). User-facing strings go through `types.ts` / `en.ts` / `es.ts`.
- E2E env: `ADMIN_EMAILS=e2e-admin@example.com`, `CATALOG_API_TOKEN=e2e-catalog-token-0123456789abcdef0123456789abcdef`. Appliances created by e2e use ids starting with `e2e-` and are retired at the end of the test.
- Commit messages: `<type>: <description>`, no attribution lines.
- Immutability: return new arrays and objects; no in-place mutation.

---

### Task 0: Worktree setup

**Files:** none committed.

- [ ] **Step 1:** Install dependencies (this worktree has no `node_modules`) and copy local env from the main checkout.
```bash
npm ci
cp ../../../.env.local .env.local
```
- [ ] **Step 2:** Baseline. Run `npm run typecheck && npm test`. Expected: all green. If anything fails here, stop and report; it is not caused by this plan.

---

### Task 1: Appliance schema and the bundled snapshot

**Files:**
- Create: `src/lib/catalog-schema.ts`, `src/lib/catalog-schema.test.ts`, `src/lib/catalog-snapshot.ts`
- Modify: `src/lib/catalog.ts` (add fields to `CatalogItem`)
- Temporary (not committed): `scripts/gen-appliance-seed.ts`

**Interfaces — Produces:**
```ts
// src/lib/catalog.ts
export interface ApplianceLabel { name: string; note: string }
export interface ApplianceLabels { en: ApplianceLabel; es: ApplianceLabel }
export interface CatalogItem { /* existing fields */ labels?: ApplianceLabels; retired?: boolean }

// src/lib/catalog-schema.ts
export const APPLIANCE_CATEGORIES: readonly ['Kitchen','Living','Climate','Air conditioning','Work','Utility','Security','Personal']
export type ApplianceCategory = (typeof APPLIANCE_CATEGORIES)[number]
export const ApplianceSchema: z.ZodType<ApplianceInput>
export interface ApplianceInput { id: string; category: ApplianceCategory; watts: number; surge: number; duty: number; tons: number | null; acType: CompressorType | null; labels: ApplianceLabels; sortOrder?: number }
export interface ApplianceRecord extends Omit<ApplianceInput, 'sortOrder'> { sortOrder: number; retired: boolean }
export function toCatalogItem(r: ApplianceRecord): CatalogItem
export function applianceWarnings(a: ApplianceInput): string[]
export type ParsedItems = { ok: true; items: ApplianceInput[] } | { ok: false; errors: Array<{ index: number; issues: Array<{ path: string; message: string }> }> }
export function parseItems(body: unknown): ParsedItems   // accepts one item or an array of 1..100
export function slugify(name: string): string

// src/lib/catalog-snapshot.ts
export const APPLIANCE_SEED: readonly ApplianceRecord[]   // 36 rows, sortOrder 10, 20, …
export const CATALOG_SNAPSHOT: readonly CatalogItem[]     // APPLIANCE_SEED.map(toCatalogItem)
```

- [ ] **Step 1: Add the label types to `CatalogItem`** in `src/lib/catalog.ts`:
```ts
export interface ApplianceLabel { name: string; note: string }
export interface ApplianceLabels { en: ApplianceLabel; es: ApplianceLabel }

export interface CatalogItem {
  id: string
  name: string
  cat: Category
  watts: number
  surge: number
  duty: number
  note: string
  tons?: number
  acType?: CompressorType
  isCustom?: boolean
  /** Per-locale name and note; catalog items have them, custom loads do not. */
  labels?: ApplianceLabels
  /** Hidden from the picker; still counted in projects that use it. */
  retired?: boolean
}
```

- [ ] **Step 2: Write the failing tests** in `src/lib/catalog-schema.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { CATEGORIES } from './catalog'
import { APPLIANCE_CATEGORIES, ApplianceSchema, applianceWarnings, parseItems, slugify, toCatalogItem, type ApplianceInput } from './catalog-schema'
import { APPLIANCE_SEED, CATALOG_SNAPSHOT } from './catalog-snapshot'

const stove: ApplianceInput = {
  id: 'induction-2', category: 'Kitchen', watts: 3500, surge: 3500, duty: 0.15, tons: null, acType: null,
  labels: { en: { name: '2-burner induction cooktop', note: '' }, es: { name: 'Anafe de inducción de 2 hornillas', note: '' } },
}

describe('ApplianceSchema', () => {
  test('accepts a valid appliance', () => {
    expect(ApplianceSchema.safeParse(stove).success).toBe(true)
  })
  test.each([
    ['surge below watts', { surge: 100 }],
    ['zero duty', { duty: 0 }],
    ['duty above 1', { duty: 1.2 }],
    ['watts above 30 kW', { watts: 30_001, surge: 30_001 }],
    ['non-integer watts', { watts: 10.5 }],
    ['bad id', { id: 'Induction 2' }],
    ['Custom category', { category: 'Custom' }],
    ['AC fields outside Air conditioning', { tons: 1 }],
    ['missing Spanish name', { labels: { en: stove.labels.en, es: { name: '', note: '' } } }],
  ])('rejects %s', (_, patch) => {
    expect(ApplianceSchema.safeParse({ ...stove, ...patch }).success).toBe(false)
  })
  test('requires tons and acType for air conditioning', () => {
    expect(ApplianceSchema.safeParse({ ...stove, category: 'Air conditioning' }).success).toBe(false)
    expect(ApplianceSchema.safeParse({ ...stove, category: 'Air conditioning', tons: 1, acType: 'inverter' }).success).toBe(true)
  })
  test('rejects unknown keys', () => {
    expect(ApplianceSchema.safeParse({ ...stove, price: 10 }).success).toBe(false)
  })
})

test('APPLIANCE_CATEGORIES is every category except Custom, in order', () => {
  expect(APPLIANCE_CATEGORIES).toEqual(CATEGORIES.filter((c) => c !== 'Custom'))
})

describe('parseItems', () => {
  test('accepts one item or an array', () => {
    expect(parseItems(stove)).toEqual({ ok: true, items: [stove] })
    expect(parseItems([stove, { ...stove, id: 'induction-4' }])).toMatchObject({ ok: true, items: [{ id: 'induction-2' }, { id: 'induction-4' }] })
  })
  test('reports issues per item index and accepts nothing when any item fails', () => {
    const r = parseItems([stove, { ...stove, surge: 1 }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual([{ index: 1, issues: [expect.objectContaining({ path: 'surge' })] }])
  })
  test('rejects an empty array and more than 100 items', () => {
    expect(parseItems([]).ok).toBe(false)
    expect(parseItems(Array.from({ length: 101 }, (_, i) => ({ ...stove, id: `s-${i}` }))).ok).toBe(false)
  })
})

describe('applianceWarnings', () => {
  test('flags very large loads and nonstop heavy loads, and nothing for ordinary ones', () => {
    expect(applianceWarnings(stove)).toEqual([])
    expect(applianceWarnings({ ...stove, watts: 7000, surge: 7000 })).toHaveLength(1)
    expect(applianceWarnings({ ...stove, duty: 1 })).toHaveLength(1)
  })
})

test('slugify makes an id from an English name', () => {
  expect(slugify('2-burner Induction Cooktop (240 V)')).toBe('2-burner-induction-cooktop-240-v')
  expect(slugify('  Ñandú ñ ')).toBe('nandu-n')
})

describe('snapshot', () => {
  test('has the 36 current appliances, all valid, with unique ids and increasing sort order', () => {
    expect(APPLIANCE_SEED).toHaveLength(36)
    for (const r of APPLIANCE_SEED) {
      const input = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'retired'))
      expect(ApplianceSchema.safeParse(input).success, r.id).toBe(true)
    }
    expect(new Set(APPLIANCE_SEED.map((r) => r.id)).size).toBe(36)
    const orders = APPLIANCE_SEED.map((r) => r.sortOrder)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })
  test('keeps the Spanish text and the AC placement', () => {
    const fridge = CATALOG_SNAPSHOT.find((a) => a.id === 'fridge')
    expect(fridge?.labels?.es.name).toBe('Refrigerador')
    const ids = CATALOG_SNAPSHOT.map((a) => a.id)
    expect(ids.indexOf('ac1i')).toBe(ids.indexOf('heater') + 1)
  })
  test('toCatalogItem maps a record to the engine shape, English name first', () => {
    const ac = CATALOG_SNAPSHOT.find((a) => a.id === 'ac2i')
    expect(ac).toMatchObject({ name: '2 ton AC · inverter', cat: 'Air conditioning', watts: 2200, surge: 2860, tons: 2, acType: 'inverter', retired: false })
    const fridge = toCatalogItem(APPLIANCE_SEED.find((r) => r.id === 'fridge')!)
    expect(fridge).not.toHaveProperty('tons')
    expect(fridge).not.toHaveProperty('acType')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail.** Run `npx vitest run src/lib/catalog-schema.test.ts`. Expected: FAIL, "Cannot find module './catalog-schema'".

- [ ] **Step 4: Implement `src/lib/catalog-schema.ts`**:
```ts
import { z } from 'zod'
import type { ApplianceLabels, CatalogItem, CompressorType } from './catalog'

export const APPLIANCE_CATEGORIES = ['Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal'] as const
export type ApplianceCategory = (typeof APPLIANCE_CATEGORIES)[number]

export const MAX_APPLIANCE_WATTS = 30_000
const MAX_BATCH = 100
const LARGE_LOAD_W = 5000
const NONSTOP_HEAVY_W = 1000
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/

const Label = z.object({ name: z.string().trim().min(1).max(80), note: z.string().trim().max(160) }).strict()

export const ApplianceSchema = z
  .object({
    id: z.string().regex(ID_PATTERN, 'lowercase letters, digits and dashes'),
    category: z.enum(APPLIANCE_CATEGORIES),
    watts: z.number().int().min(1).max(MAX_APPLIANCE_WATTS),
    surge: z.number().int().min(1).max(MAX_APPLIANCE_WATTS * 4),
    duty: z.number().gt(0).lte(1),
    tons: z.number().positive().nullable().default(null),
    acType: z.enum(['inverter', 'conventional']).nullable().default(null),
    labels: z.object({ en: Label, es: Label }).strict(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((a) => a.surge >= a.watts, { path: ['surge'], message: 'surge must be at least the running watts' })
  .refine((a) => (a.category === 'Air conditioning') === (a.tons !== null && a.acType !== null), {
    path: ['category'],
    message: 'tons and acType are required for Air conditioning, and only for it',
  })

export type ApplianceInput = z.infer<typeof ApplianceSchema>
export interface ApplianceRecord extends Omit<ApplianceInput, 'sortOrder'> { sortOrder: number; retired: boolean }

export function toCatalogItem(r: ApplianceRecord): CatalogItem {
  return {
    id: r.id, name: r.labels.en.name, note: r.labels.en.note, cat: r.category,
    watts: r.watts, surge: r.surge, duty: r.duty,
    ...(r.tons !== null ? { tons: r.tons } : {}),
    ...(r.acType !== null ? { acType: r.acType as CompressorType } : {}),
    labels: r.labels as ApplianceLabels,
    retired: r.retired,
  }
}

/** Soft checks: worth a second look, never a reason to refuse. */
export function applianceWarnings(a: ApplianceInput): string[] {
  const out: string[] = []
  if (a.watts > LARGE_LOAD_W) out.push(`Over ${LARGE_LOAD_W / 1000} kW: check this is one appliance, not a whole circuit.`)
  if (a.duty === 1 && a.watts >= NONSTOP_HEAVY_W) out.push('Runs nonstop at 1 kW or more: most heating and motor loads cycle.')
  return out
}

export type ParsedItems =
  | { ok: true; items: ApplianceInput[] }
  | { ok: false; errors: Array<{ index: number; issues: Array<{ path: string; message: string }> }> }

export function parseItems(body: unknown): ParsedItems {
  const list = Array.isArray(body) ? body : [body]
  if (list.length === 0 || list.length > MAX_BATCH) {
    return { ok: false, errors: [{ index: -1, issues: [{ path: '', message: `send 1 to ${MAX_BATCH} items` }] }] }
  }
  const results = list.map((item) => ApplianceSchema.safeParse(item))
  const errors = results.flatMap((r, index) =>
    r.success ? [] : [{ index, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }],
  )
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, items: results.map((r) => r.data!) }
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
```

- [ ] **Step 5: Generate the snapshot from today's catalog and dictionaries.** Create the temporary `scripts/gen-appliance-seed.ts`:
```ts
import { APPLIANCES } from '../src/lib/catalog'
import { en } from '../src/i18n/en'
import { es } from '../src/i18n/es'

const rows = APPLIANCES.map((a, i) => ({
  id: a.id, category: a.cat, watts: a.watts, surge: a.surge, duty: a.duty,
  tons: a.tons ?? null, acType: a.acType ?? null,
  labels: { en: en.appliances[a.id], es: es.appliances[a.id] },
  sortOrder: (i + 1) * 10, retired: false,
}))
const header = `import type { CatalogItem } from './catalog'
import { toCatalogItem, type ApplianceRecord } from './catalog-schema'

/**
 * The catalog as first seeded into Postgres (migration 0004). Served when the database cannot be read, and the
 * fixture for engine tests. The drift test keeps it equal to the seed migration.
 */
export const APPLIANCE_SEED: readonly ApplianceRecord[] = `
process.stdout.write(`${header}${JSON.stringify(rows, null, 2)}\n\nexport const CATALOG_SNAPSHOT: readonly CatalogItem[] = APPLIANCE_SEED.map(toCatalogItem)\n`)
```
Run it:
```bash
npx -y tsx scripts/gen-appliance-seed.ts > src/lib/catalog-snapshot.ts
rm scripts/gen-appliance-seed.ts
```
Open `src/lib/catalog-snapshot.ts` and check that it has 36 rows, and that every `labels.en` and `labels.es` is an object (none is `undefined`).

- [ ] **Step 6: Run the tests to verify they pass.** Run `npx vitest run src/lib/catalog-schema.test.ts && npm run typecheck`. Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/catalog.ts src/lib/catalog-schema.ts src/lib/catalog-schema.test.ts src/lib/catalog-snapshot.ts
git commit -m "feat: appliance schema and a bundled snapshot of the current catalog"
```

---

### Task 2: The engine takes the catalog as an argument

**Files:**
- Modify: `src/lib/catalog.ts` (delete `BASE`, `AC_TONS`, `COMPRESSORS`, `airConditioners`, `APPLIANCES`; add `forPicker`), `src/lib/sizing.ts`, `src/lib/project-summary.ts`
- Modify: `src/hooks/useRootData.ts` (add `catalog`, snapshot for now), create `src/hooks/useCatalog.ts`
- Modify: `src/routes/index.tsx`, `src/components/KitStep.tsx`, `src/components/KitQuickEdit.tsx`, `src/components/ApplianceGrid.tsx`, `src/components/ProjectCards.tsx`
- Tests: `src/lib/sizing.test.ts`, `src/lib/catalog.test.ts`, `src/lib/appliance-groups.test.ts`, `src/lib/appliance-search.test.ts`, `src/lib/kit-deltas.test.ts`, `src/lib/project-summary.test.ts`, `src/i18n/i18n.test.ts`

**Interfaces:**
- Consumes: `CATALOG_SNAPSHOT` (Task 1).
- Produces:
```ts
export function catalog(appliances: readonly CatalogItem[], custom?: readonly CustomLoadLike[]): CatalogItem[]   // sizing.ts
export function compute(input: SizingInput, appliances: readonly CatalogItem[]): SizingResult                  // sizing.ts
export function computeProject(p: Project, appliances: readonly CatalogItem[]): SizingResult                   // project-summary.ts
export function summarizeProjects(projects: readonly Project[], appliances: readonly CatalogItem[], topN?: number): ProjectSummary[]
export const forPicker: (items: readonly CatalogItem[]) => CatalogItem[]                                       // catalog.ts: drops retired
export interface RootData { locale: Locale; user: SessionUser | null; googleEnabled: boolean; catalog: CatalogItem[] }
export function useCatalog(): readonly CatalogItem[]                                                           // hooks/useCatalog.ts
```

- [ ] **Step 1: Update the tests first.** Import `CATALOG_SNAPSHOT` from `./catalog-snapshot` in place of `APPLIANCES` from `./catalog` everywhere (the three `src/lib/*.test.ts` files and `src/i18n/i18n.test.ts`). Pass it as the new argument:
  - `compute(input)` becomes `compute(input, CATALOG_SNAPSHOT)` in `sizing.test.ts`, `kit-deltas.test.ts` and `project-summary.test.ts`. Also update the `computeProject(p)` and `summarizeProjects(ps)` calls in `project-summary.test.ts`.
  - `catalog(custom)` becomes `catalog(CATALOG_SNAPSHOT, custom)` in `sizing.test.ts` and `appliance-search.test.ts`.

  Do not touch any expected number. Add to `sizing.test.ts`:
```ts
test('skips quantities for ids that are not in the catalog, and counts retired items', () => {
  const retired = CATALOG_SNAPSHOT.map((a) => (a.id === 'fridge' ? { ...a, retired: true } : a))
  const withGhost = compute({ qty: { fridge: 1, 'no-such-thing': 3 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, retired)
  expect(withGhost.items.map((i) => i.id)).toEqual(['fridge'])
})
```
Add to `catalog.test.ts`:
```ts
test('forPicker hides retired items and keeps the rest in order', () => {
  const items = CATALOG_SNAPSHOT.map((a) => (a.id === 'tv' ? { ...a, retired: true } : a))
  const picked = forPicker(items)
  expect(picked.map((a) => a.id)).not.toContain('tv')
  expect(picked).toHaveLength(CATALOG_SNAPSHOT.length - 1)
})
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npm test`. Expected: FAIL on type/arity (`compute` expects 1 argument, `forPicker` not exported).

- [ ] **Step 3: Implement.**
  - In `src/lib/catalog.ts`, delete `BASE`, `AC_TONS`, `COMPRESSORS`, `airConditioners`, `insertAt` and `APPLIANCES`. Keep `SIZING.WATTS_PER_TON`, since the `catalog.test.ts` AC assertions use it. Add:
```ts
/** What the appliance picker offers: the catalog without retired items. The engine still counts retired ones. */
export const forPicker = (items: readonly CatalogItem[]): CatalogItem[] => items.filter((i) => !i.retired)
```
  - In `src/lib/sizing.ts`, remove `APPLIANCES` from the import and change:
```ts
export function catalog(appliances: readonly CatalogItem[], custom: readonly CustomLoadLike[] = []): CatalogItem[] {
  const extra: CatalogItem[] = custom.map((c) => ({
    id: c.id, name: c.name, cat: 'Custom', watts: c.watts, surge: c.surge, duty: 1, note: c.note, isCustom: true,
  }))
  return [...appliances, ...extra]
}

export function compute(input: SizingInput, appliances: readonly CatalogItem[]): SizingResult {
  // …unchanged…
  const items = selectItems(catalog(appliances, input.custom), input.qty ?? {}, hours)
```
  - `src/lib/project-summary.ts`:
```ts
export function computeProject(p: Project, appliances: readonly CatalogItem[]): SizingResult {
  return compute({ qty: p.qty, custom: p.custom, hours: p.hours, volts: p.volts, chemistry: p.chemistry, batteryUnit: p.batteryUnit }, appliances)
}

export function summarizeProjects(projects: readonly Project[], appliances: readonly CatalogItem[], topN: number = DEFAULT_TOP): ProjectSummary[] {
  const results = projects.map((p) => computeProject(p, appliances))
```
  - `src/hooks/useRootData.ts`: add `catalog: CatalogItem[]` to `RootData`, and default it with `catalog: data?.catalog ?? [...CATALOG_SNAPSHOT]`.
  - `src/routes/__root.tsx` loader: return `catalog: [...CATALOG_SNAPSHOT]` for now. Task 5 replaces this with the database.
  - Create `src/hooks/useCatalog.ts`:
```ts
import type { CatalogItem } from '../lib/catalog'
import { useRootData } from './useRootData'

/** The appliance catalog loaded once with the page; retired items included (filter with `forPicker` for pickers). */
export function useCatalog(): readonly CatalogItem[] {
  return useRootData().catalog
}
```
  - Components: call `const appliances = useCatalog()`, then:
    - `index.tsx`: `computeProject(project, appliances)`
    - `KitStep.tsx`: `computeProject(undo.snapshot, appliances)`
    - `ProjectCards.tsx`: `summarizeProjects(store.projects, appliances)`
    - `ApplianceGrid.tsx`: `catalog(forPicker(appliances), project.custom)`
    - `KitQuickEdit.tsx`: `catalog(forPicker(appliances), project.custom)`

- [ ] **Step 4: Run the tests to verify they pass.** Run `npm run typecheck && npm test`. Expected: PASS, with the same numbers as before.

- [ ] **Step 5: Commit.**
```bash
git add -A src
git commit -m "refactor: pass the appliance catalog to the sizing engine instead of importing it"
```

---

### Task 3: Appliance names come from the item, not the dictionary

**Files:**
- Modify: `src/i18n/index.ts`, `src/i18n/types.ts`, `src/i18n/en.ts`, `src/i18n/es.ts`, `src/components/KitSummary.tsx`
- Test: `src/i18n/i18n.test.ts`

**Interfaces:** `applianceName(t, item)` and `applianceNote(t, item)` keep their signatures. The item type becomes `Pick<CatalogItem, 'id' | 'name' | 'note' | 'isCustom' | 'labels'>`, with `note` required only for `applianceNote`. `Dictionary` loses `appliances`.

- [ ] **Step 1: Failing tests.** In `src/i18n/i18n.test.ts`, import `CATALOG_SNAPSHOT` from `../lib/catalog-snapshot`. Remove the appliance half of "every catalog appliance and category is translated" (keep the category loop), and replace the two appliance tests:
```ts
const fridge = CATALOG_SNAPSHOT.find((a) => a.id === 'fridge')!

test('applianceName reads the item labels in the active language and keeps custom names', () => {
  expect(applianceName(getDictionary('es'), fridge)).toBe('Refrigerador')
  expect(applianceName(getDictionary('en'), fridge)).toBe('Refrigerator')
  expect(applianceName(getDictionary('es'), { id: 'custom1', name: 'Bomba', isCustom: true })).toBe('Bomba')
  expect(applianceName(getDictionary('es'), { id: 'unknown', name: 'Fallback' })).toBe('Fallback')
})

test('applianceNote reads the item labels and keeps custom notes', () => {
  expect(applianceNote(getDictionary('es'), fridge)).toBe('El compresor trabaja ~35% de cada hora')
  expect(applianceNote(getDictionary('es'), { id: 'custom1', note: 'Custom · 230 V × 4.5 A', isCustom: true })).toBe('Custom · 230 V × 4.5 A')
  expect(applianceNote(getDictionary('es'), { id: 'unknown', note: 'Fallback' })).toBe('Fallback')
})

test('dictionaries no longer carry appliance names', () => {
  expect('appliances' in getDictionary('en')).toBe(false)
})
```
- [ ] **Step 2:** Run `npx vitest run src/i18n`. Expected: FAIL (the last test, since dictionaries still have `appliances`).
- [ ] **Step 3: Implement.** In `src/i18n/index.ts`, add `import type { ApplianceLabels } from '../lib/catalog'` and:
```ts
type Labelled = { id: string; name: string; isCustom?: boolean; labels?: ApplianceLabels }

export function applianceName(t: Dictionary, item: Labelled): string {
  return item.isCustom ? item.name : (item.labels?.[t.locale]?.name ?? item.name)
}

export function applianceNote(t: Dictionary, item: Labelled & { note: string }): string {
  return item.isCustom ? item.note : (item.labels?.[t.locale]?.note ?? item.note)
}
```
Then:
  - Delete `appliances` from `Dictionary` in `types.ts`, and delete the `appliances: { … }` blocks in `en.ts` and `es.ts`.
  - In `KitSummary.tsx`, the dominant-load warning only carries an id and an English name, so look the item up in the result. Change `warningText(t, w)` to `warningText(t, w, r.items)`:
```ts
function warningText(t: Dictionary, w: Warning, items: readonly SelectedItem[]): string {
  const item = items.find((i) => i.id === w.params.itemId)
  const itemName = item ? applianceName(t, item) : w.params.itemName
  return t.warnings[w.code]({ ...w.params, itemName })
}
```
  - Update its call site to pass `r.items`.
- [ ] **Step 4:** Run `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add -A src
git commit -m "refactor: read appliance names and notes from the catalog item's labels"
```

---

### Task 4: The `appliances` table and the seed migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/lib/catalog-seed.ts`, `src/lib/catalog-seed.test.ts`, `drizzle/0003_*.sql` (generated), `drizzle/0004_seed_appliances.sql`, and the updated `drizzle/meta/*`

**Interfaces — Produces:**
```ts
export const appliances: PgTable   // src/db/schema.ts
export function seedSql(rows: readonly ApplianceRecord[]): string   // src/lib/catalog-seed.ts
```

- [ ] **Step 1: Failing test** `src/lib/catalog-seed.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { seedSql } from './catalog-seed'
import { APPLIANCE_SEED } from './catalog-snapshot'

test('escapes quotes and writes nulls, jsonb and an idempotent conflict clause', () => {
  const sql = seedSql([{ ...APPLIANCE_SEED[0]!, labels: { en: { name: "Kid's fridge", note: '' }, es: { name: 'Nevera', note: '' } } }])
  expect(sql).toContain(`'{"en":{"name":"Kid''s fridge","note":""},"es":{"name":"Nevera","note":""}}'::jsonb`)
  expect(sql).toContain('NULL, NULL')
  expect(sql.trim().endsWith('ON CONFLICT ("id") DO NOTHING;')).toBe(true)
})

test('the seed migration is exactly the bundled snapshot (no drift)', () => {
  expect(readFileSync('drizzle/0004_seed_appliances.sql', 'utf8')).toBe(seedSql(APPLIANCE_SEED))
})
```
- [ ] **Step 2:** Run `npx vitest run src/lib/catalog-seed.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/lib/catalog-seed.ts`**:
```ts
import type { ApplianceRecord } from './catalog-schema'

const COLUMNS = ['id', 'category', 'watts', 'surge', 'duty', 'tons', 'ac_type', 'labels', 'sort_order', 'updated_by']
const text = (s: string) => `'${s.replaceAll("'", "''")}'`
const orNull = <T>(v: T | null, f: (x: T) => string) => (v === null ? 'NULL' : f(v))

/** The seed migration's SQL. Re-running it is harmless: existing ids are left alone. */
export function seedSql(rows: readonly ApplianceRecord[]): string {
  const values = rows.map((r) =>
    `(${[
      text(r.id), text(r.category), r.watts, r.surge, r.duty,
      orNull(r.tons, String), orNull(r.acType, text),
      `${text(JSON.stringify(r.labels))}::jsonb`, r.sortOrder, text('seed'),
    ].join(', ')})`,
  )
  return `INSERT INTO "appliances" (${COLUMNS.map((c) => `"${c}"`).join(', ')}) VALUES\n${values.join(',\n')}\nON CONFLICT ("id") DO NOTHING;\n`
}
```
- [ ] **Step 4: Add the table** to `src/db/schema.ts`. Extend the existing `drizzle-orm/pg-core` import with `check, doublePrecision`; add `import { sql } from 'drizzle-orm'`, `import type { ApplianceLabels } from '../lib/catalog'` and `import { APPLIANCE_CATEGORIES } from '../lib/catalog-schema'`.
```ts
const categoryList = sql.raw(APPLIANCE_CATEGORIES.map((c) => `'${c}'`).join(', '))

export const appliances = pgTable(
  'appliances',
  {
    id: text('id').primaryKey(),
    category: text('category').notNull(),
    watts: integer('watts').notNull(),
    surge: integer('surge').notNull(),
    // double precision, not real: real would turn 0.35 into 0.3499999940… and change the kit numbers.
    duty: doublePrecision('duty').notNull(),
    tons: doublePrecision('tons'),
    acType: text('ac_type'),
    labels: jsonb('labels').$type<ApplianceLabels>().notNull(),
    sortOrder: integer('sort_order').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    check('appliances_category_check', sql`${t.category} in (${categoryList})`),
    check('appliances_surge_check', sql`${t.surge} >= ${t.watts}`),
    check('appliances_duty_check', sql`${t.duty} > 0 and ${t.duty} <= 1`),
  ],
)
```
- [ ] **Step 5: Generate both migrations.**
```bash
npm run db:generate
npx drizzle-kit generate --custom --name=seed_appliances
npx -y tsx --eval "import { seedSql } from './src/lib/catalog-seed'; import { APPLIANCE_SEED } from './src/lib/catalog-snapshot'; process.stdout.write(seedSql(APPLIANCE_SEED))" > drizzle/0004_seed_appliances.sql
```
Check that `drizzle/0003_*.sql` creates `appliances` with the three `CHECK`s and `double precision` for `duty` and `tons`.
- [ ] **Step 6: Apply and verify.** Run `npm run db:migrate`, then `npx vitest run src/lib/catalog-seed.test.ts && npm run typecheck`. Expected: PASS. In `npm run db:studio`, `appliances` has 36 rows.
- [ ] **Step 7: Commit.**
```bash
git add src/db/schema.ts src/lib/catalog-seed.ts src/lib/catalog-seed.test.ts drizzle
git commit -m "feat: appliances table seeded with the current catalog"
```

---

### Task 5: Read the catalog from the database, cached, with the snapshot as fallback

**Files:**
- Create: `src/lib/ttl-cache.ts`, `src/lib/ttl-cache.test.ts`, `src/server/catalog-repo.ts` (read side), `src/server/catalog.ts`
- Modify: `src/routes/__root.tsx`

**Interfaces — Produces:**
```ts
export interface TtlCache<T> { get(load: () => Promise<T>): Promise<T>; clear(): void }
export function ttlCache<T>(ttlMs: number, now?: () => number): TtlCache<T>
export function withFallback<T>(load: () => Promise<T>, fallback: T, onError: (e: unknown) => void): Promise<T>
// src/server/catalog-repo.ts
export const CATALOG_TTL_MS = 60_000
export const catalogCache: TtlCache<CatalogItem[]>
export async function listRecords(): Promise<ApplianceRecord[]>
export async function queryCatalog(): Promise<CatalogItem[]>
// src/server/catalog.ts
export const getCatalog: ServerFn<GET, () => Promise<CatalogItem[]>>
```

- [ ] **Step 1: Failing tests** `src/lib/ttl-cache.test.ts`:
```ts
import { expect, test, vi } from 'vitest'
import { ttlCache, withFallback } from './ttl-cache'

test('serves the cached value until the TTL passes, then reloads', async () => {
  let now = 0
  const cache = ttlCache<number>(60_000, () => now)
  const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
  expect(await cache.get(load)).toBe(1)
  now = 59_999
  expect(await cache.get(load)).toBe(1)
  now = 60_000
  expect(await cache.get(load)).toBe(2)
  expect(load).toHaveBeenCalledTimes(2)
})

test('clear forces the next read to reload', async () => {
  const cache = ttlCache<number>(60_000, () => 0)
  const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
  await cache.get(load)
  cache.clear()
  expect(await cache.get(load)).toBe(2)
})

test('a failed load is not cached', async () => {
  const cache = ttlCache<number>(60_000, () => 0)
  await expect(cache.get(() => Promise.reject(new Error('db down')))).rejects.toThrow('db down')
  expect(await cache.get(() => Promise.resolve(3))).toBe(3)
})

test('withFallback returns the fallback and reports the error', async () => {
  const onError = vi.fn()
  expect(await withFallback(() => Promise.reject(new Error('x')), 'snap', onError)).toBe('snap')
  expect(onError).toHaveBeenCalledWith(expect.any(Error))
  expect(await withFallback(() => Promise.resolve('live'), 'snap', onError)).toBe('live')
})
```
- [ ] **Step 2:** Run `npx vitest run src/lib/ttl-cache.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `src/lib/ttl-cache.ts`**:
```ts
export interface TtlCache<T> { get(load: () => Promise<T>): Promise<T>; clear(): void }

/** One value kept for `ttlMs`. Per server instance: other instances refresh on their own clock. */
export function ttlCache<T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  let entry: { value: T; at: number } | null = null
  return {
    async get(load) {
      if (entry && now() - entry.at < ttlMs) return entry.value
      const value = await load()
      entry = { value, at: now() }
      return value
    },
    clear() {
      entry = null
    },
  }
}

export async function withFallback<T>(load: () => Promise<T>, fallback: T, onError: (e: unknown) => void): Promise<T> {
  try {
    return await load()
  } catch (error) {
    onError(error)
    return fallback
  }
}
```
- [ ] **Step 4: Read side of the repository**, `src/server/catalog-repo.ts`:
```ts
import { asc } from 'drizzle-orm'
import { db } from '../db/client'
import { appliances } from '../db/schema'
import type { CatalogItem } from '../lib/catalog'
import { ApplianceSchema, toCatalogItem, type ApplianceRecord } from '../lib/catalog-schema'
import { ttlCache } from '../lib/ttl-cache'

export const CATALOG_TTL_MS = 60_000
export const catalogCache = ttlCache<CatalogItem[]>(CATALOG_TTL_MS)

type Row = typeof appliances.$inferSelect

/** A row that no longer passes the schema (edited by hand in the console) is skipped and logged, not served. */
function toRecord(row: Row): ApplianceRecord | null {
  const parsed = ApplianceSchema.safeParse({
    id: row.id, category: row.category, watts: row.watts, surge: row.surge, duty: row.duty,
    tons: row.tons, acType: row.acType, labels: row.labels, sortOrder: row.sortOrder,
  })
  if (!parsed.success) {
    console.error('[catalog] skipping invalid appliance row', { id: row.id, issues: parsed.error.issues })
    return null
  }
  return { ...parsed.data, sortOrder: row.sortOrder, retired: row.retiredAt !== null }
}

export async function listRecords(): Promise<ApplianceRecord[]> {
  const rows = await db.select().from(appliances).orderBy(asc(appliances.sortOrder), asc(appliances.id))
  return rows.map(toRecord).filter((r): r is ApplianceRecord => r !== null)
}

export async function queryCatalog(): Promise<CatalogItem[]> {
  return (await listRecords()).map(toCatalogItem)
}
```
- [ ] **Step 5: Server function**, `src/server/catalog.ts`:
```ts
import { createServerFn } from '@tanstack/react-start'
import type { CatalogItem } from '../lib/catalog'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { withFallback } from '../lib/ttl-cache'
import { catalogCache, queryCatalog } from './catalog-repo'

/** The appliance catalog for the page; the bundled snapshot when the database cannot be read. */
export const getCatalog = createServerFn({ method: 'GET' }).handler(async (): Promise<CatalogItem[]> =>
  withFallback(() => catalogCache.get(queryCatalog), [...CATALOG_SNAPSHOT], (error) =>
    console.error('[getCatalog] catalog query failed; serving the bundled snapshot', error),
  ),
)
```
- [ ] **Step 6: Root loader.** In `src/routes/__root.tsx`:
```ts
const [locale, session, features, catalog] = await Promise.all([getLocale(), getSession(), getAuthFeatures(), getCatalog()])
return { locale, user: session?.user ?? null, googleEnabled: features.googleEnabled, catalog }
```
- [ ] **Step 7: Verify.** Run `npm run typecheck && npm test`. Then start the dev server (`preview_start`, or `npm run dev`) and confirm that step 1 lists the same appliances in EN and ES as on `main`. Temporarily set a bad `DATABASE_URL` host and confirm the page still renders from the snapshot, with `[getCatalog]` in the server log. Restore the URL afterwards.
- [ ] **Step 8: Commit.**
```bash
git add src/lib/ttl-cache.ts src/lib/ttl-cache.test.ts src/server/catalog-repo.ts src/server/catalog.ts src/routes/__root.tsx
git commit -m "feat: load the appliance catalog from Postgres with a 60 s cache and snapshot fallback"
```

---

### Task 6: Pure helpers for writes, auth and admin

**Files:**
- Create: `src/lib/catalog-diff.ts`, `src/lib/catalog-diff.test.ts`, `src/lib/api-token.ts`, `src/lib/api-token.test.ts`, `src/lib/admin.ts`, `src/lib/admin.test.ts`

**Interfaces — Produces:**
```ts
// catalog-diff.ts
export interface FieldChange { field: 'category' | 'watts' | 'surge' | 'duty' | 'tons' | 'acType' | 'labels'; from: unknown; to: unknown }
export type ApplianceChange = { id: string; kind: 'new' } | { id: string; kind: 'changed'; fields: FieldChange[] } | { id: string; kind: 'unchanged' }
export function diffAppliances(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): ApplianceChange[]
export function assignSortOrders(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): ApplianceRecord[] // retired taken from existing, false for new
// api-token.ts
export const MIN_TOKEN_LENGTH = 32
export function isApiEnabled(expected: string | undefined): boolean
export function bearerToken(header: string | null): string | null
export function tokenMatches(given: string | null, expected: string | undefined): boolean
export function failureThrottle(opts: { limit: number; windowMs: number; now?: () => number }): { isBlocked(key: string): boolean; recordFailure(key: string): void }
// admin.ts
export function isAdmin(user: { email: string; emailVerified: boolean } | null | undefined, adminEmailsRaw: string | undefined): boolean
```

- [ ] **Step 1: Failing tests.**
`src/lib/catalog-diff.test.ts`:
```ts
import { expect, test } from 'vitest'
import { assignSortOrders, diffAppliances } from './catalog-diff'
import { APPLIANCE_SEED } from './catalog-snapshot'

const fridge = APPLIANCE_SEED.find((r) => r.id === 'fridge')!
const fridgeInput = {
  id: fridge.id, category: fridge.category, watts: fridge.watts, surge: fridge.surge, duty: fridge.duty,
  tons: fridge.tons, acType: fridge.acType, labels: fridge.labels,
}

test('marks new, changed (with the fields) and unchanged items', () => {
  const stove = { ...fridgeInput, id: 'stove', labels: { en: { name: 'Stove', note: '' }, es: { name: 'Estufa', note: '' } } }
  const changes = diffAppliances(APPLIANCE_SEED, [stove, { ...fridgeInput, watts: 180, surge: 1200 }, fridgeInput])
  expect(changes).toEqual([
    { id: 'stove', kind: 'new' },
    { id: 'fridge', kind: 'changed', fields: [{ field: 'watts', from: 150, to: 180 }] },
    { id: 'fridge', kind: 'unchanged' },
  ])
})

test('ignores key order inside labels', () => {
  const reordered = { ...fridgeInput, labels: { es: { note: fridge.labels.es.note, name: fridge.labels.es.name }, en: fridge.labels.en } }
  expect(diffAppliances(APPLIANCE_SEED, [reordered])).toEqual([{ id: 'fridge', kind: 'unchanged' }])
})

test('appends new items after the highest sort order and keeps existing ones in place', () => {
  const max = Math.max(...APPLIANCE_SEED.map((r) => r.sortOrder))
  const out = assignSortOrders(APPLIANCE_SEED, [{ ...fridgeInput, id: 'a-new' }, { ...fridgeInput, id: 'b-new' }, fridgeInput])
  expect(out.map((r) => [r.id, r.sortOrder, r.retired])).toEqual([['a-new', max + 10, false], ['b-new', max + 20, false], ['fridge', fridge.sortOrder, false]])
})

test('an explicit sortOrder wins', () => {
  expect(assignSortOrders(APPLIANCE_SEED, [{ ...fridgeInput, sortOrder: 5 }])[0]!.sortOrder).toBe(5)
})
```
`src/lib/api-token.test.ts`:
```ts
import { expect, test } from 'vitest'
import { bearerToken, failureThrottle, isApiEnabled, tokenMatches } from './api-token'

const TOKEN = 'x'.repeat(32)

test('the API is off without a token of at least 32 characters', () => {
  expect(isApiEnabled(undefined)).toBe(false)
  expect(isApiEnabled('short')).toBe(false)
  expect(isApiEnabled(TOKEN)).toBe(true)
})

test('reads a bearer token', () => {
  expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN)
  expect(bearerToken(`bearer  ${TOKEN} `)).toBe(TOKEN)
  expect(bearerToken('Basic abc')).toBeNull()
  expect(bearerToken(null)).toBeNull()
})

test('matches only the exact configured token', () => {
  expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
  expect(tokenMatches(`${TOKEN}y`, TOKEN)).toBe(false)
  expect(tokenMatches(null, TOKEN)).toBe(false)
  expect(tokenMatches(TOKEN, undefined)).toBe(false)
  expect(tokenMatches('short', 'short')).toBe(false)
})

test('throttles a key after the limit within the window, then forgets', () => {
  let now = 0
  const t = failureThrottle({ limit: 2, windowMs: 1000, now: () => now })
  t.recordFailure('ip')
  expect(t.isBlocked('ip')).toBe(false)
  t.recordFailure('ip')
  expect(t.isBlocked('ip')).toBe(true)
  expect(t.isBlocked('other')).toBe(false)
  now = 1000
  expect(t.isBlocked('ip')).toBe(false)
})
```
`src/lib/admin.test.ts`:
```ts
import { expect, test } from 'vitest'
import { isAdmin } from './admin'

test('an admin has a verified email listed in ADMIN_EMAILS, case-insensitive', () => {
  const raw = ' Alex@Example.com , other@example.com'
  expect(isAdmin({ email: 'alex@example.com', emailVerified: true }, raw)).toBe(true)
  expect(isAdmin({ email: 'alex@example.com', emailVerified: false }, raw)).toBe(false)
  expect(isAdmin({ email: 'eve@example.com', emailVerified: true }, raw)).toBe(false)
  expect(isAdmin({ email: 'alex@example.com', emailVerified: true }, undefined)).toBe(false)
  expect(isAdmin(null, raw)).toBe(false)
})
```
- [ ] **Step 2:** Run `npx vitest run src/lib/catalog-diff.test.ts src/lib/api-token.test.ts src/lib/admin.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
`src/lib/catalog-diff.ts`:
```ts
import type { ApplianceInput, ApplianceRecord } from './catalog-schema'

const COMPARED = ['category', 'watts', 'surge', 'duty', 'tons', 'acType', 'labels'] as const
const SORT_STEP = 10

export interface FieldChange { field: (typeof COMPARED)[number]; from: unknown; to: unknown }
export type ApplianceChange =
  | { id: string; kind: 'new' }
  | { id: string; kind: 'changed'; fields: FieldChange[] }
  | { id: string; kind: 'unchanged' }

/** JSON with object keys sorted, so jsonb's key reordering never reads as a change. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
}

export function diffAppliances(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): ApplianceChange[] {
  const byId = new Map(existing.map((r) => [r.id, r]))
  return incoming.map((item): ApplianceChange => {
    const current = byId.get(item.id)
    if (!current) return { id: item.id, kind: 'new' }
    const fields = COMPARED.filter((f) => stable(current[f]) !== stable(item[f])).map((field) => ({ field, from: current[field], to: item[field] }))
    return fields.length > 0 ? { id: item.id, kind: 'changed', fields } : { id: item.id, kind: 'unchanged' }
  })
}

/** Existing items keep their place; new ones go after the last item, in the order given. */
export function assignSortOrders(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): ApplianceRecord[] {
  const byId = new Map(existing.map((r) => [r.id, r]))
  const base = existing.reduce((max, r) => Math.max(max, r.sortOrder), 0)
  const newIds = incoming.filter((i) => !byId.has(i.id)).map((i) => i.id)
  return incoming.map(({ sortOrder, ...item }) => {
    const current = byId.get(item.id)
    const order = sortOrder ?? current?.sortOrder ?? base + (newIds.indexOf(item.id) + 1) * SORT_STEP
    return { ...item, sortOrder: order, retired: current?.retired ?? false }
  })
}
```
`src/lib/api-token.ts`:
```ts
import { createHash, timingSafeEqual } from 'node:crypto'

export const MIN_TOKEN_LENGTH = 32
const digest = (s: string) => createHash('sha256').update(s).digest()

export const isApiEnabled = (expected: string | undefined): boolean => !!expected && expected.length >= MIN_TOKEN_LENGTH

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '')
  return match ? match[1]!.trim() : null
}

/** Compares fixed-length digests so the check takes the same time whatever the input. */
export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !isApiEnabled(expected)) return false
  return timingSafeEqual(digest(given), digest(expected!))
}

export function failureThrottle(opts: { limit: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now
  let hits = new Map<string, readonly number[]>()
  const recent = (key: string) => (hits.get(key) ?? []).filter((t) => now() - t < opts.windowMs)
  return {
    isBlocked: (key: string): boolean => recent(key).length >= opts.limit,
    recordFailure: (key: string): void => {
      hits = new Map(hits).set(key, [...recent(key), now()])
    },
  }
}
```
`src/lib/admin.ts`:
```ts
/**
 * Admin = a verified email listed in ADMIN_EMAILS. The verified check matters: sign-up does not confirm emails,
 * so anyone could otherwise register the admin's address first.
 */
export function isAdmin(user: { email: string; emailVerified: boolean } | null | undefined, adminEmailsRaw: string | undefined): boolean {
  if (!user?.emailVerified) return false
  const allowed = new Set((adminEmailsRaw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
  return allowed.has(user.email.trim().toLowerCase())
}
```
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/lib/catalog-diff.ts src/lib/catalog-diff.test.ts src/lib/api-token.ts src/lib/api-token.test.ts src/lib/admin.ts src/lib/admin.test.ts
git commit -m "feat: catalog diff, API token check with throttle, and admin check"
```

---

### Task 7: Write path and the REST API

**Files:**
- Modify: `src/server/catalog-repo.ts` (write side)
- Create: `src/server/catalog-api.ts`, `src/routes/api/catalog/appliances.ts`, `src/routes/api/catalog/appliances.$id.retire.ts`, `src/routes/api/catalog/appliances.$id.restore.ts`, `e2e/catalog-api.spec.ts`
- Modify: `playwright.config.ts` (e2e env)

**Interfaces:**
- Consumes: `listRecords`, `catalogCache` (Task 5); `parseItems` (Task 1); `diffAppliances`, `assignSortOrders`, `tokenMatches`, `bearerToken`, `isApiEnabled`, `failureThrottle` (Task 6).
- Produces:
```ts
// catalog-repo.ts
export async function upsertAppliances(items: readonly ApplianceInput[], actor: string): Promise<{ created: string[]; updated: string[] }>
export async function setRetired(id: string, retired: boolean, actor: string): Promise<boolean>   // false = no such id
// catalog-api.ts
export function authorize(request: Request): Response | null   // null = allowed
export const json: (body: unknown, status?: number) => Response
```

- [ ] **Step 1: Failing e2e** `e2e/catalog-api.spec.ts`. The webServer gets its env from Step 2, so this suite runs once, on the desktop project only.
```ts
import { expect, test } from '@playwright/test'

const TOKEN = 'e2e-catalog-token-0123456789abcdef0123456789abcdef'
const auth = { Authorization: `Bearer ${TOKEN}` }
const id = `e2e-${Date.now()}`
const item = {
  id, category: 'Kitchen', watts: 3500, surge: 3500, duty: 0.15, tons: null, acType: null,
  labels: { en: { name: `E2E cooktop ${id}`, note: 'Test item' }, es: { name: `Anafe E2E ${id}`, note: 'Ítem de prueba' } },
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'API checks run once')
})

test('the catalog API needs the token', async ({ request }) => {
  expect((await request.get('/api/catalog/appliances')).status()).toBe(401)
  expect((await request.get('/api/catalog/appliances', { headers: { Authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' } })).status()).toBe(401)
})

test('dry run, create, show in the picker in both languages, then retire', async ({ request, page }) => {
  const dry = await request.post('/api/catalog/appliances?dryRun=true', { headers: auth, data: item })
  expect(dry.status()).toBe(200)
  expect(await dry.json()).toEqual({ changes: [{ id, kind: 'new' }] })
  expect((await request.get('/api/catalog/appliances', { headers: auth })).ok()).toBe(true)

  const bad = await request.post('/api/catalog/appliances', { headers: auth, data: { ...item, surge: 1 } })
  expect(bad.status()).toBe(422)

  const created = await request.post('/api/catalog/appliances', { headers: auth, data: [item] })
  expect(await created.json()).toEqual({ created: [id], updated: [] })

  await page.goto('/?step=1')
  await expect(page.getByText(`E2E cooktop ${id}`)).toBeVisible()
  await page.context().addCookies([{ name: 'lang', value: 'es', url: page.url() }])
  await page.reload()
  await expect(page.getByText(`Anafe E2E ${id}`)).toBeVisible()

  expect((await request.post(`/api/catalog/appliances/${id}/retire`, { headers: auth })).status()).toBe(200)
  await page.reload()
  await expect(page.getByText(`Anafe E2E ${id}`)).toHaveCount(0)
  expect((await request.post('/api/catalog/appliances/no-such-id/retire', { headers: auth })).status()).toBe(404)
})
```
- [ ] **Step 2: E2E env.** In `playwright.config.ts`, add `ADMIN_EMAILS=e2e-admin@example.com CATALOG_API_TOKEN=e2e-catalog-token-0123456789abcdef0123456789abcdef` to the `npm run start` part of `webServer.command`, next to the Google vars.
- [ ] **Step 3:** Run `npx playwright test e2e/catalog-api.spec.ts --project=desktop`. Expected: FAIL (404 on the routes).
- [ ] **Step 4: Write side of the repository.** Append to `src/server/catalog-repo.ts`, extending its imports with `eq, sql` from `drizzle-orm`, `assignSortOrders, diffAppliances` from `../lib/catalog-diff`, and `type ApplianceInput` from `../lib/catalog-schema`:
```ts
/** The only way appliances are written. Unchanged items are skipped; one statement, so it is all or nothing. */
export async function upsertAppliances(items: readonly ApplianceInput[], actor: string): Promise<{ created: string[]; updated: string[] }> {
  const existing = await listRecords()
  const changes = diffAppliances(existing, items)
  const toWrite = assignSortOrders(existing, items).filter((_, i) => changes[i]!.kind !== 'unchanged')
  if (toWrite.length > 0) {
    await db
      .insert(appliances)
      .values(toWrite.map((r) => ({
        id: r.id, category: r.category, watts: r.watts, surge: r.surge, duty: r.duty, tons: r.tons, acType: r.acType,
        labels: r.labels, sortOrder: r.sortOrder, updatedBy: actor,
      })))
      .onConflictDoUpdate({
        target: appliances.id,
        set: {
          category: sql`excluded.category`, watts: sql`excluded.watts`, surge: sql`excluded.surge`, duty: sql`excluded.duty`,
          tons: sql`excluded.tons`, acType: sql`excluded.ac_type`, labels: sql`excluded.labels`, sortOrder: sql`excluded.sort_order`,
          updatedAt: sql`now()`, updatedBy: sql`excluded.updated_by`,
        },
      })
    catalogCache.clear()
  }
  return {
    created: changes.filter((c) => c.kind === 'new').map((c) => c.id),
    updated: changes.filter((c) => c.kind === 'changed').map((c) => c.id),
  }
}

export async function setRetired(id: string, retired: boolean, actor: string): Promise<boolean> {
  const rows = await db
    .update(appliances)
    .set({ retiredAt: retired ? sql`now()` : null, updatedAt: sql`now()`, updatedBy: actor })
    .where(eq(appliances.id, id))
    .returning({ id: appliances.id })
  if (rows.length > 0) catalogCache.clear()
  return rows.length > 0
}
```
- [ ] **Step 5: API guard**, `src/server/catalog-api.ts`:
```ts
import { bearerToken, failureThrottle, isApiEnabled, tokenMatches } from '../lib/api-token'

const FAILURE_LIMIT = 10
const FAILURE_WINDOW_MS = 10 * 60_000
const throttle = failureThrottle({ limit: FAILURE_LIMIT, windowMs: FAILURE_WINDOW_MS })

export const API_ACTOR = 'api-token'
export const json = (body: unknown, status = 200): Response => Response.json(body, { status })

const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

/** Null when the request may proceed; otherwise the response to send. Unconfigured = the API does not exist. */
export function authorize(request: Request): Response | null {
  const expected = process.env.CATALOG_API_TOKEN
  if (!isApiEnabled(expected)) return json({ error: 'Not found' }, 404)
  const ip = clientIp(request)
  if (throttle.isBlocked(ip)) return json({ error: 'Too many failed attempts; try again later' }, 429)
  if (!tokenMatches(bearerToken(request.headers.get('authorization')), expected)) {
    throttle.recordFailure(ip)
    console.warn('[catalog-api] rejected a request with a missing or wrong token', { ip, path: new URL(request.url).pathname })
    return json({ error: 'Unauthorized' }, 401)
  }
  return null
}
```
- [ ] **Step 6: Routes.** `src/routes/api/catalog/appliances.ts`:
```ts
import { createFileRoute } from '@tanstack/react-router'
import { diffAppliances } from '../../../lib/catalog-diff'
import { parseItems } from '../../../lib/catalog-schema'
import { API_ACTOR, authorize, json } from '../../../server/catalog-api'
import { listRecords, upsertAppliances } from '../../../server/catalog-repo'

export const Route = createFileRoute('/api/catalog/appliances')({
  server: {
    handlers: {
      GET: async ({ request }) => authorize(request) ?? json({ items: await listRecords() }),
      POST: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        const body = await request.json().catch(() => undefined)
        const parsed = parseItems(body)
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        if (new URL(request.url).searchParams.get('dryRun') === 'true') {
          return json({ changes: diffAppliances(await listRecords(), parsed.items) })
        }
        try {
          return json(await upsertAppliances(parsed.items, API_ACTOR))
        } catch (error) {
          console.error('[catalog-api] upsert failed', { ids: parsed.items.map((i) => i.id), error })
          return json({ error: 'Could not save; nothing was written' }, 500)
        }
      },
    },
  },
})
```
Retire and restore share one handler. Add it to `src/server/catalog-api.ts`, and extend that file's imports with `import { setRetired } from './catalog-repo'`:
```ts
export function retiredHandler(retired: boolean) {
  return async ({ request, params }: { request: Request; params: { id: string } }): Promise<Response> => {
    const denied = authorize(request)
    if (denied) return denied
    return (await setRetired(params.id, retired, API_ACTOR)) ? json({ id: params.id, retired }) : json({ error: 'Not found' }, 404)
  }
}
```
`src/routes/api/catalog/appliances.$id.retire.ts`:
```ts
import { createFileRoute } from '@tanstack/react-router'
import { retiredHandler } from '../../../server/catalog-api'

export const Route = createFileRoute('/api/catalog/appliances/$id/retire')({
  server: { handlers: { POST: retiredHandler(true) } },
})
```
`src/routes/api/catalog/appliances.$id.restore.ts`:
```ts
import { createFileRoute } from '@tanstack/react-router'
import { retiredHandler } from '../../../server/catalog-api'

export const Route = createFileRoute('/api/catalog/appliances/$id/restore')({
  server: { handlers: { POST: retiredHandler(false) } },
})
```
Run `npm run dev` once so the route tree (`src/routeTree.gen.ts`) regenerates with the three new routes.
- [ ] **Step 7: Verify.** Run `npm run typecheck && npx playwright test e2e/catalog-api.spec.ts --project=desktop`. Expected: PASS.
- [ ] **Step 8: Commit.**
```bash
git add -A src e2e playwright.config.ts
git commit -m "feat: token-protected REST API to add, update, retire and restore appliances"
```

---

### Task 8: Admin page

**Files:**
- Create: `src/server/admin-catalog.ts`, `src/routes/admin/appliances.tsx`, `src/components/admin/ApplianceForm.tsx`, `src/components/admin/admin.css`, `e2e/admin.spec.ts`, `e2e/db.ts`
- Modify: `playwright.config.ts` (load `.env.local` for the test process)

**Interfaces:**
- Consumes: `isAdmin` (Task 6), `listRecords`, `upsertAppliances`, `setRetired` (Tasks 5 and 7), `ApplianceSchema`, `applianceWarnings`, `slugify`, `APPLIANCE_CATEGORIES` (Task 1).
- Produces:
```ts
export const checkAdmin: ServerFn<GET, () => Promise<boolean>>
export const adminListAppliances: ServerFn<GET, () => Promise<ApplianceRecord[]>>
export const adminSaveAppliance: ServerFn<POST, (data: ApplianceInput) => Promise<{ created: string[]; updated: string[] }>>
export const adminSetRetired: ServerFn<POST, (data: { id: string; retired: boolean }) => Promise<{ ok: true }>>
```

- [ ] **Step 1: Failing e2e.** `e2e/db.ts`:
```ts
import { neon } from '@neondatabase/serverless'

/** Sign-up never verifies emails, and the admin check requires a verified one. Tests mark their admin by hand. */
export async function markEmailVerified(email: string): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is needed for admin e2e tests')
  await neon(url)`update "user" set email_verified = true where email = ${email}`
}
```
`e2e/admin.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test'
import { markEmailVerified } from './db'

const ADMIN = { email: 'e2e-admin@example.com', password: 'correct-horse-battery-admin' }

async function signInOrUp(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  if (await page.getByText(`Signed in as ${email}`).isVisible({ timeout: 3000 }).catch(() => false)) return
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'admin checks run once')
})

test('non-admins get a 404 at /admin/appliances', async ({ page }) => {
  await page.goto('/admin/appliances')
  await expect(page.getByText('Page not found')).toBeVisible()
  await signInOrUp(page, `e2e-${Date.now()}@example.com`, 'correct-horse-battery')
  await page.goto('/admin/appliances')
  await expect(page.getByText('Page not found')).toBeVisible()
})

test('an admin adds an appliance, sees it in the picker, and retires it', async ({ page }) => {
  await signInOrUp(page, ADMIN.email, ADMIN.password)
  await markEmailVerified(ADMIN.email)
  // The session cookie caches the user for 5 minutes; a fresh sign-in picks up email_verified.
  await page.context().clearCookies()
  await signInOrUp(page, ADMIN.email, ADMIN.password)
  const name = `E2E hot plate ${Date.now()}`
  await page.goto('/admin/appliances')
  await page.getByRole('button', { name: 'New appliance' }).click()
  await page.getByLabel('Name (EN)').fill(name)
  await page.getByLabel('Name (ES)').fill(`Parrilla ${name}`)
  await page.getByLabel('Category').selectOption('Kitchen')
  await page.getByLabel('Running watts').fill('1500')
  await page.getByLabel('Surge watts').fill('1500')
  await page.getByLabel('Duty').fill('0.2')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()

  await page.goto('/?step=1')
  await expect(page.getByText(name)).toBeVisible()

  await page.goto('/admin/appliances')
  await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Retire' }).click()
  await page.goto('/?step=1')
  await expect(page.getByText(name)).toHaveCount(0)
})
```
"Page not found" is the English `notFound` UI string, which the root `notFoundComponent` renders.

In `playwright.config.ts`, add at the top:
```ts
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
```
Also make admin-created ids start with `e2e-`: the form's id comes from `slugify(nameEn)`, and `E2E hot plate …` slugifies to `e2e-hot-plate-…`.
- [ ] **Step 2:** Run `npx playwright test e2e/admin.spec.ts --project=desktop`. Expected: FAIL (no route).
- [ ] **Step 3: Server functions**, `src/server/admin-catalog.ts`:
```ts
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { isAdmin } from '../lib/admin'
import { auth } from '../lib/auth'
import { ApplianceSchema, type ApplianceRecord } from '../lib/catalog-schema'
import { listRecords, setRetired, upsertAppliances } from './catalog-repo'

async function adminUser() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return session && isAdmin(session.user, process.env.ADMIN_EMAILS) ? session.user : null
}

/** Throws a plain "Not found" so a non-admin cannot tell the admin tools exist. */
const requireAdmin = createServerOnlyFn(async () => {
  const user = await adminUser()
  if (!user) throw new Error('Not found')
  return user
})

export const checkAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean> => (await adminUser()) !== null)

export const adminListAppliances = createServerFn({ method: 'GET' }).handler(async (): Promise<ApplianceRecord[]> => {
  await requireAdmin()
  return listRecords()
})

export const adminSaveAppliance = createServerFn({ method: 'POST' })
  .validator((d: unknown) => ApplianceSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    return upsertAppliances([data], user.id)
  })

export const adminSetRetired = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ id: z.string().min(1), retired: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    if (!(await setRetired(data.id, data.retired, user.id))) throw new Error('Not found')
    return { ok: true as const }
  })
```
- [ ] **Step 4: Route**, `src/routes/admin/appliances.tsx`. The loader fetches the list, and the component renders a table grouped by category with Edit and Retire/Restore buttons, plus the form:
```tsx
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ApplianceForm } from '../../components/admin/ApplianceForm'
import '../../components/admin/admin.css'
import { APPLIANCE_CATEGORIES, type ApplianceRecord } from '../../lib/catalog-schema'
import { adminListAppliances, adminSetRetired, checkAdmin } from '../../server/admin-catalog'

export const Route = createFileRoute('/admin/appliances')({
  beforeLoad: async () => {
    if (!(await checkAdmin())) throw notFound()
  },
  loader: () => adminListAppliances(),
  component: AdminAppliances,
})

function AdminAppliances() {
  const items = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState<ApplianceRecord | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The root loader caches the catalog for the visit; invalidate so the picker sees the change.
  const refresh = () => router.invalidate()
  const toggleRetired = async (r: ApplianceRecord) => {
    setError(null)
    try {
      await adminSetRetired({ data: { id: r.id, retired: !r.retired } })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the appliance')
    }
  }
  return (
    <main className="admin">
      <header className="admin__head">
        <h1>Appliances</h1>
        <button type="button" onClick={() => setEditing('new')}>New appliance</button>
      </header>
      {error && <p role="alert" className="admin__error">{error}</p>}
      {editing && (
        <ApplianceForm
          initial={editing === 'new' ? null : editing}
          onSaved={async () => { setEditing(null); await refresh() }}
          onCancel={() => setEditing(null)}
        />
      )}
      <table className="admin__table">
        <thead><tr><th>Name</th><th>Watts</th><th>Surge</th><th>Duty</th><th>Status</th><th /></tr></thead>
        {APPLIANCE_CATEGORIES.map((cat) => (
          <tbody key={cat}>
            <tr><th colSpan={6} scope="rowgroup">{cat}</th></tr>
            {items.filter((r) => r.category === cat).map((r) => (
              <tr key={r.id} className={r.retired ? 'is-retired' : undefined}>
                <td>{r.labels.en.name}<br /><small>{r.labels.es.name} · {r.id}</small></td>
                <td>{r.watts}</td><td>{r.surge}</td><td>{r.duty}</td>
                <td>{r.retired ? 'Retired' : 'Active'}</td>
                <td>
                  <button type="button" onClick={() => setEditing(r)}>Edit</button>
                  <button type="button" onClick={() => toggleRetired(r)}>{r.retired ? 'Restore' : 'Retire'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </main>
  )
}
```
- [ ] **Step 5: Form**, `src/components/admin/ApplianceForm.tsx`. Keep a draft of strings, build the input on submit, validate with `ApplianceSchema` in the browser, show hard errors per field and soft warnings, and call `adminSaveAppliance`:
```tsx
import { useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { APPLIANCE_CATEGORIES, ApplianceSchema, applianceWarnings, slugify, type ApplianceRecord } from '../../lib/catalog-schema'
import { adminSaveAppliance } from '../../server/admin-catalog'

type Draft = Record<'nameEn' | 'noteEn' | 'nameEs' | 'noteEs' | 'category' | 'watts' | 'surge' | 'duty' | 'tons' | 'acType', string>

const toDraft = (r: ApplianceRecord | null): Draft => ({
  nameEn: r?.labels.en.name ?? '', noteEn: r?.labels.en.note ?? '', nameEs: r?.labels.es.name ?? '', noteEs: r?.labels.es.note ?? '',
  category: r?.category ?? 'Kitchen', watts: String(r?.watts ?? ''), surge: String(r?.surge ?? ''), duty: String(r?.duty ?? ''),
  tons: r?.tons != null ? String(r.tons) : '', acType: r?.acType ?? '',
})

function toInput(d: Draft, id: string) {
  const isAc = d.category === 'Air conditioning'
  return {
    id, category: d.category, watts: Number(d.watts), surge: Number(d.surge), duty: Number(d.duty),
    tons: isAc && d.tons ? Number(d.tons) : null, acType: isAc && d.acType ? d.acType : null,
    labels: { en: { name: d.nameEn, note: d.noteEn }, es: { name: d.nameEs, note: d.noteEs } },
  }
}

export function ApplianceForm({ initial, onSaved, onCancel }: { initial: ApplianceRecord | null; onSaved: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)
  const id = initial?.id ?? slugify(draft.nameEn)
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value })
  const parsed = ApplianceSchema.safeParse(toInput(draft, id))
  const warnings = parsed.success ? applianceWarnings(parsed.data) : []

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])))
      return
    }
    setSaving(true)
    try {
      await adminSaveAppliance({ data: parsed.data })
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, k: keyof Draft, errKey: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="admin__field">
      <span>{label}</span>
      <input value={draft[k]} onChange={set(k)} aria-invalid={!!errors[errKey]} {...props} />
      {errors[errKey] && <small className="admin__error">{errors[errKey]}</small>}
    </label>
  )

  return (
    <form className="admin__form" onSubmit={submit} noValidate>
      <p className="admin__id">id: <code>{id || '—'}</code>{!initial && ' (fixed after saving)'}</p>
      {field('Name (EN)', 'nameEn', 'labels.en.name')}
      {field('Note (EN)', 'noteEn', 'labels.en.note')}
      {field('Name (ES)', 'nameEs', 'labels.es.name')}
      {field('Note (ES)', 'noteEs', 'labels.es.note')}
      <label className="admin__field">
        <span>Category</span>
        <select value={draft.category} onChange={set('category')}>
          {APPLIANCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {errors.category && <small className="admin__error">{errors.category}</small>}
      </label>
      {field('Running watts', 'watts', 'watts', { inputMode: 'numeric' })}
      {field('Surge watts', 'surge', 'surge', { inputMode: 'numeric' })}
      {field('Duty', 'duty', 'duty', { inputMode: 'decimal' })}
      {draft.category === 'Air conditioning' && (
        <>
          {field('Tons', 'tons', 'tons', { inputMode: 'decimal' })}
          <label className="admin__field">
            <span>Compressor</span>
            <select value={draft.acType} onChange={set('acType')}>
              <option value="">—</option><option value="inverter">inverter</option><option value="conventional">conventional</option>
            </select>
          </label>
        </>
      )}
      {warnings.map((w) => <p key={w} className="admin__warn">{w}</p>)}
      {saveError && <p role="alert" className="admin__error">{saveError}</p>}
      <div className="admin__actions">
        <button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
```
`src/components/admin/admin.css`. Before writing it, check `src/styles.css` for the real token names and swap them in for `--line`, `--muted`, `--danger` and `--warn` if they differ. The fallbacks keep it readable either way.
```css
.admin { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
.admin__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.admin__form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; padding: 16px; margin-bottom: 24px; border: 1px solid var(--line, #d4d4d8); border-radius: 12px; }
.admin__id, .admin__actions, .admin__warn, .admin__form > [role='alert'] { grid-column: 1 / -1; }
.admin__field { display: grid; gap: 4px; }
.admin__actions { display: flex; gap: 8px; }
.admin__error { color: var(--danger, #b91c1c); }
.admin__warn { color: var(--warn, #b45309); margin: 0; }
.admin__table { width: 100%; border-collapse: collapse; }
.admin__table th, .admin__table td { padding: 8px; border-bottom: 1px solid var(--line, #e4e4e7); text-align: left; vertical-align: top; }
.admin__table tbody th { padding-top: 20px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #71717a); }
.admin__table .is-retired td { opacity: 0.5; }
@media (max-width: 640px) {
  .admin__form { grid-template-columns: 1fr; }
  .admin__table { display: block; overflow-x: auto; }
}
```
- [ ] **Step 6: Verify.** Run `npm run typecheck && npx playwright test e2e/admin.spec.ts --project=desktop`. Expected: PASS. Then open `/admin/appliances` in the preview as the admin and screenshot the page.
- [ ] **Step 7: Commit.**
```bash
git add -A src e2e playwright.config.ts
git commit -m "feat: admin page to add, edit, retire and restore appliances"
```

---

### Task 9: Split-phase note for heavy appliances

**Files:**
- Modify: `src/lib/catalog.ts` (`SIZING.SPLIT_PHASE_W`, `needsSplitPhase`), `src/lib/sizing.ts` (new warning), `src/i18n/types.ts`, `src/i18n/en.ts`, `src/i18n/es.ts`, `src/components/ApplianceCard.tsx`
- Test: `src/lib/sizing.test.ts`, `src/lib/catalog.test.ts`

**Interfaces — Produces:** `SIZING.SPLIT_PHASE_W = 3000`; `needsSplitPhase(item: { watts: number }): boolean`; `WarningCode` gains `'splitPhase'` (params `itemId`, `itemName`); UiKey `'splitPhase'`.

- [ ] **Step 1: Failing tests.** `catalog.test.ts` (add `needsSplitPhase` to its `./catalog` import):
```ts
test('needsSplitPhase starts at 3 kW', () => {
  expect(needsSplitPhase({ watts: 2999 })).toBe(false)
  expect(needsSplitPhase({ watts: 3000 })).toBe(true)
})
```
`sizing.test.ts`:
```ts
test('warns once about a split-phase inverter when a selected appliance draws 3 kW or more', () => {
  const r = compute({ qty: { wheater: 1, fridge: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
  expect(r.warnings.filter((w) => w.code === 'splitPhase')).toEqual([{ code: 'splitPhase', params: { itemId: 'wheater', itemName: 'Electric water heater' } }])
  const light = compute({ qty: { fridge: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
  expect(light.warnings.some((w) => w.code === 'splitPhase')).toBe(false)
})
```
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `SPLIT_PHASE_W: 3000` to `SIZING`.
  - Add `export const needsSplitPhase = (item: { watts: number }) => item.watts >= SIZING.SPLIT_PHASE_W` to `catalog.ts`.
  - In `buildWarnings`, after the dominant-load warning:
```ts
const heavy = ctx.items.find(needsSplitPhase)
if (heavy) w.push({ code: 'splitPhase', params: { itemId: heavy.id, itemName: heavy.name } })
```
  - Add `'splitPhase'` to `WarningCode`. Add the warning text:
    - `en.ts`: ``splitPhase: (p) => `${p.itemName} usually runs on 240 V. You need a split-phase (240 V) inverter or two stacked units.` ``
    - `es.ts`: ``splitPhase: (p) => `${p.itemName} normalmente funciona a 240 V. Necesitas un inversor de fase partida (240 V) o dos unidades acopladas.` ``
  - Add the UiKey `'splitPhase'`:
    - `en`: `'Needs a 240 V / split-phase inverter'`
    - `es`: `'Requiere un inversor de 240 V / fase partida'`
  - In `ApplianceCard`, under the spec line: `{needsSplitPhase(item) && <div className="card__spec card__spec--warn">{t.ui.splitPhase}</div>}`. Add `.card__spec--warn { color: var(--warn, #b45309); }` to the card styles, reusing an existing warning token if `styles.css` has one.
- [ ] **Step 4:** Run `npm run typecheck && npm test`. Expected: PASS. Check the water heater card in the preview in EN and ES.
- [ ] **Step 5: Commit.**
```bash
git add -A src
git commit -m "feat: flag appliances that need a 240 V split-phase inverter"
```

---

### Task 10: `/research-appliance` skill and env docs

**Files:**
- Create: `.claude/skills/research-appliance/SKILL.md`, `.env.example`
- Modify: `.gitignore` if needed (`.env*` is ignored and `!.env.example` is already allowed)

- [ ] **Step 1: Write the skill**, `.claude/skills/research-appliance/SKILL.md`:
````markdown
---
name: research-appliance
description: Research an appliance's running watts, start surge and duty cycle, then add or update it in the solar-dimension catalog through the token-protected API after the user confirms. Use for "/research-appliance <description>" or "add <appliance> to the catalog".
---

# Research an appliance into the catalog

Arguments: `<description> [--target local|prod]` (default `local`).

## Setup
- Read `CATALOG_API_TOKEN` from `.env.local`. Base URL: `http://localhost:3000` for local; for prod, `CATALOG_API_URL` from `.env.local`.
- Never print, echo or log the token. Pass it only in the `Authorization: Bearer` header.

## Steps
1. **Research** typical values for the described appliance (one row per distinct size or type the user asked for):
   - `watts`: typical running watts (integer).
   - `surge`: start surge in watts (integer, ≥ watts). Resistive loads (heaters, stoves, kettles) have surge = watts; motors and compressors are 2–3×; inverter compressors ~1.3×.
   - `duty`: share of each hour it draws power while in use (0 < duty ≤ 1). Match the existing items: fridge 0.35, microwave 0.08, water heater 0.25.
   - Keep one source (URL or datasheet) for each number.
2. **Write labels** in the same tone as the existing items: EN and ES `name` (short, with size if it matters, e.g. "Induction cooktop, 2 burners") and `note` (how it cycles, e.g. "~10 min per hour of cooking"). Spanish is Latin American.
3. **Check for duplicates:** `curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/catalog/appliances`. Reuse an existing id if the item is already there (that makes it an update). Otherwise make an id with lowercase letters, digits and dashes.
4. **Dry run:** `POST $BASE/api/catalog/appliances?dryRun=true` with a JSON array of items shaped `{ id, category, watts, surge, duty, tons: null, acType: null, labels: { en: {name, note}, es: {name, note} } }`. Category is one of Kitchen, Living, Climate, Air conditioning, Work, Utility, Security, Personal.
5. **Show the user a table:** id, new or changed (with old → new), EN name, ES name, watts, surge, duty, and the source for each number. Mention any item of 3 kW or more (the app flags it as needing a 240 V split-phase inverter).
6. **Wait for an explicit yes.** Then `POST $BASE/api/catalog/appliances` with the same body and report `created` / `updated`.
7. **On errors:** 422 → show the per-item issues, fix, and repeat from step 4. 401 → the token is wrong or missing in `.env.local`. 404 → the API is disabled on that target (`CATALOG_API_TOKEN` unset there).
````
- [ ] **Step 2: `.env.example`**:
```bash
DATABASE_URL=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Comma-separated; the account must have a verified email (sign in with Google once).
ADMIN_EMAILS=
# At least 32 random characters: openssl rand -hex 32. Unset = catalog API disabled.
CATALOG_API_TOKEN=
# Base URL the /research-appliance skill uses with --target prod.
CATALOG_API_URL=
```
- [ ] **Step 3: Commit.**
```bash
git add .claude/skills/research-appliance/SKILL.md .env.example
git commit -m "docs: research-appliance skill and env example for the catalog API"
```

---

### Task 11: Full verification

- [ ] **Step 1:** Run `npm run typecheck && npm run test:coverage`. Expected: PASS, with coverage at or above 80% on `src/lib` and `src/i18n`.
- [ ] **Step 2:** Run `npm run build && npm run e2e`. Expected: every spec passes on desktop and phone. The API and admin specs skip on phone.
- [ ] **Step 3:** Search for leftovers: `rg -n "APPLIANCES\b|t\.appliances|\.appliances\[" src` should find no hits.
- [ ] **Step 4:** Manual check in the preview:
  - step 1 lists the same appliances as on `main`, in EN and ES
  - the kit numbers for a saved project match `main`
  - `/admin/appliances` returns 404 when signed out
- [ ] **Step 5:** Before merging, set these in Vercel production, not in previews unless wanted:
  - `ADMIN_EMAILS`
  - `CATALOG_API_TOKEN` (from `openssl rand -hex 32`)
  - `CATALOG_API_URL` in the local `.env.local`
  
  Make sure the admin account has `email_verified = true` (sign in with Google once, or set it in the Neon console).
