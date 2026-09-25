# AC groups, Security category, typed quantities: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group AC cards by compressor type, add a Security category with CCTV cameras and recorders, and let people type a quantity up to 100.

**Architecture:** Catalog data and limits live in `src/lib/catalog.ts`; a new pure helper `src/lib/appliance-groups.ts` turns the filtered item list into grid entries (headers + items) that `ApplianceGrid` renders. `ApplianceCard` gains an optional `title` override and a typed quantity field that commits through `setQty` via a pure `parseQty`.

**Tech Stack:** React 19, TanStack Start, Vitest, Playwright, en/es dictionaries in `src/i18n`.

Spec: `docs/superpowers/specs/2026-09-24-ac-groups-security-qty-design.md`

## Global Constraints
- `SIZING.MAX_QTY` = 100 (was 20); client clamp and server zod schema both read it.
- Every new ui key exists in `en.ts`, `es.ts` and the `UiKey` union in `types.ts` (the i18n test fails otherwise).
- No catalog ids change. New ids: `cctv`, `nvr16`, `nvr32`.
- Search text present → no AC grouping, full names.
- Commit messages: `<type>: <description>`, no attribution lines.

---

### Task 1: Security category, CCTV items, MAX_QTY 100

**Files:**
- Modify: `src/lib/catalog.ts` (`Category`, `CATEGORIES`, `SIZING.MAX_QTY`, `BASE`)
- Modify: `src/i18n/en.ts`, `src/i18n/es.ts` (`categories`, `appliances`)
- Test: `src/lib/store.test.ts`, `src/lib/catalog.test.ts`

**Interfaces:** Produces `Category` value `'Security'`; items `cctv` (7 W), `nvr16` (20 W), `nvr32` (50 W), all `duty: 1`, `surge = watts`.

- [ ] **Step 1: Failing tests.** In `store.test.ts` rename the clamp test to `'setQty clamps between 0 and 100 …'`, set `setQty(s, 'ac2c', 150)` and expect `100`. In `catalog.test.ts` add:

```ts
test('Security lists a CCTV camera and two recorder sizes, all running continuously', () => {
  const security = APPLIANCES.filter((a) => a.cat === 'Security')
  expect(security.map((a) => [a.id, a.watts, a.surge, a.duty])).toEqual([
    ['cctv', 7, 7, 1], ['nvr16', 20, 20, 1], ['nvr32', 50, 50, 1],
  ])
  expect(CATEGORIES.indexOf('Security')).toBe(CATEGORIES.indexOf('Utility') + 1)
})
```

- [ ] **Step 2:** `npx vitest run src/lib` → both fail.
- [ ] **Step 3: Implement.** `Category` adds `'Security'`; `CATEGORIES` inserts it after `'Utility'`; `MAX_QTY: 100`; append to `BASE` after `wheater`:

```ts
  { id: 'cctv', name: 'CCTV camera', cat: 'Security', watts: 7, surge: 7, duty: 1, note: 'Continuous · includes IR night vision and PoE losses' },
  { id: 'nvr16', name: 'Recorder (NVR/DVR), up to 16 cameras', cat: 'Security', watts: 20, surge: 20, duty: 1, note: 'Continuous · 1 hard drive' },
  { id: 'nvr32', name: 'Recorder (NVR/DVR), 32+ cameras', cat: 'Security', watts: 50, surge: 50, duty: 1, note: 'Continuous · 4 hard drives' },
```

  Dictionaries: `Security: 'Security'` / `Security: 'Seguridad'`; appliances en = names/notes above; es = `cctv: { name: 'Cámara de CCTV', note: 'Continuo · incluye visión nocturna IR y pérdidas PoE' }`, `nvr16: { name: 'Grabador (NVR/DVR), hasta 16 cámaras', note: 'Continuo · 1 disco duro' }`, `nvr32: { name: 'Grabador (NVR/DVR), 32+ cámaras', note: 'Continuo · 4 discos duros' }`.
- [ ] **Step 4:** `npx vitest run src` → all pass (existing i18n test checks every catalog item and category is translated).
- [ ] **Step 5:** Commit `feat: Security category with CCTV cameras and recorders; allow up to 100 of an item`.

### Task 2: AC grouped by compressor type

**Files:**
- Create: `src/lib/appliance-groups.ts`, `src/lib/appliance-groups.test.ts`
- Modify: `src/i18n/types.ts`, `en.ts`, `es.ts` (ui keys), `src/components/ApplianceGrid.tsx`, `src/components/ApplianceCard.tsx` (`title?: string`), `src/styles/components.css`

**Interfaces:**
- Produces:
```ts
export type GridEntry =
  | { kind: 'item'; item: CatalogItem; isGrouped: boolean }
  | { kind: 'acHeader'; acType: CompressorType }
export function gridEntries(items: readonly CatalogItem[], isSearching: boolean): GridEntry[]
```
- ui keys: `acInverter`, `acInverterHelp`, `acConventional`, `acConventionalHelp`, `acSizeOne`, `acSizeMany` (params `{tons}`, `{btu}`).

- [ ] **Step 1: Failing test** (`appliance-groups.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { APPLIANCES } from './catalog'
import { gridEntries } from './appliance-groups'

const ids = (e: ReturnType<typeof gridEntries>) => e.map((x) => (x.kind === 'item' ? x.item.id : `#${x.acType}`))

describe('gridEntries', () => {
  test('puts inverter sizes under one header and conventional under another, ascending, where AC sat in the list', () => {
    const e = ids(gridEntries(APPLIANCES, false))
    const start = e.indexOf('#inverter')
    expect(e.slice(start, start + 14)).toEqual([
      '#inverter', 'ac1i', 'ac15i', 'ac2i', 'ac3i', 'ac4i', 'ac5i',
      '#conventional', 'ac1c', 'ac15c', 'ac2c', 'ac3c', 'ac4c', 'ac5c',
    ])
    expect(e[start - 1]).toBe('heater')
  })
  test('while searching, AC items keep their place and no headers appear', () => {
    const e = gridEntries(APPLIANCES.filter((a) => a.id.startsWith('ac2')), true)
    expect(e.every((x) => x.kind === 'item' && !x.isGrouped)).toBe(true)
  })
  test('lists without AC pass through unchanged', () => {
    expect(ids(gridEntries(APPLIANCES.filter((a) => a.cat === 'Kitchen'), false))).toEqual(['fridge', 'freezer', 'micro', 'coffee', 'kettle', 'toaster'])
  })
})
```

- [ ] **Step 2:** run → fails (module missing).
- [ ] **Step 3: Implement** `appliance-groups.ts`:

```ts
import type { CatalogItem, CompressorType } from './catalog'

export type GridEntry =
  | { kind: 'item'; item: CatalogItem; isGrouped: boolean }
  | { kind: 'acHeader'; acType: CompressorType }

const AC_ORDER: readonly CompressorType[] = ['inverter', 'conventional']
const plain = (item: CatalogItem): GridEntry => ({ kind: 'item', item, isGrouped: false })

/** Replace the AC run with an inverter group then a conventional group, each ascending by size. Searching keeps the flat list. */
export function gridEntries(items: readonly CatalogItem[], isSearching: boolean): GridEntry[] {
  const ac = items.filter((i) => i.acType)
  if (isSearching || ac.length === 0) return items.map(plain)
  const groups = AC_ORDER.flatMap((acType): GridEntry[] => {
    const inGroup = ac.filter((i) => i.acType === acType).sort((a, b) => (a.tons ?? 0) - (b.tons ?? 0))
    return inGroup.length ? [{ kind: 'acHeader', acType }, ...inGroup.map((item) => ({ kind: 'item' as const, item, isGrouped: true }))] : []
  })
  const at = items.findIndex((i) => i.acType)
  return [...items.slice(0, at).map(plain), ...groups, ...items.filter((i, idx) => idx > at && !i.acType).map(plain)]
}
```

- [ ] **Step 4:** run → pass.
- [ ] **Step 5: i18n keys.** en: `acInverter: 'Inverter'`, `acInverterHelp: 'Soft start. Easy on the battery and inverter.'`, `acConventional: 'Conventional'`, `acConventionalHelp: 'Starts at ~3× its running power. Needs a bigger inverter.'`, `acSizeOne: '{tons} ton · {btu}k BTU'`, `acSizeMany: '{tons} ton · {btu}k BTU'`. es: `'Inverter'`, `'Arranque suave. Cuida la batería y el inversor.'`, `'Convencional'`, `'Arranca con ~3× su potencia en marcha. Necesita un inversor más grande.'`, `'{tons} tonelada · {btu}k BTU'`, `'{tons} toneladas · {btu}k BTU'`.
- [ ] **Step 6: Render.** `ApplianceGrid` maps `gridEntries(items, needle !== '')`: header → `<div className="grid__group"><h3 className="grid__group-title">{t.ui.acInverter}</h3><p className="muted grid__group-help">…</p></div>`; grouped item → `<ApplianceCard title={tr(t, item.tons === 1 ? 'acSizeOne' : 'acSizeMany', { tons: item.tons, btu: item.tons! * 12 })} …/>`. `ApplianceCard` uses `title ?? applianceName(t, item)` for the visible name only; aria-labels keep the full name. CSS: `.grid__group { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 4px 10px; flex-wrap: wrap; padding: 10px 2px 0; }`, `.grid__group-title { margin: 0; font-size: 15px; }`, `.grid__group-help { margin: 0; font-size: 13px; }`.
- [ ] **Step 7:** `npm run typecheck && npx vitest run src` → pass. Commit `feat: group the AC list by compressor type with a note on start surge`.

### Task 3: Typed quantity field

**Files:**
- Modify: `src/lib/store.ts` (+ `parseQty`), `src/lib/store.test.ts`, `src/components/ApplianceCard.tsx`, `src/i18n/*` (`qtyOf`), `src/styles/components.css`

**Interfaces:** `export function parseQty(text: string): number | null` — trimmed digits only → number, else `null`.

- [ ] **Step 1: Failing test:**

```ts
test('parseQty accepts whole numbers and rejects everything else', () => {
  expect(parseQty('32')).toBe(32)
  expect(parseQty(' 7 ')).toBe(7)
  expect(parseQty('0')).toBe(0)
  for (const bad of ['', ' ', '-1', '2.5', 'abc', '1e3']) expect(parseQty(bad)).toBeNull()
})
```

- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** `export function parseQty(text: string): number | null { const s = text.trim(); return /^\d+$/.test(s) ? Number(s) : null }`
- [ ] **Step 4:** run → pass.
- [ ] **Step 5: Card field.** Replace `<div className="num stepper-qty__n">{qty}</div>` with a `QtyField` component: local draft state reset when `qty` changes; `<input className="num stepper-qty__n" type="text" inputMode="numeric" pattern="[0-9]*" aria-label={tr(t, 'qtyOf', { name })} value={draft} onChange onFocus={select} onBlur={commit} onKeyDown={Enter → blur}>`; commit: `const n = parseQty(draft); if (n === null || n === qty) setDraft(String(qty)); else onSet(n)`. Card props add `onSet: (n: number) => void`; grid passes `(n) => commit(setQty(store, item.id, n))`. Keys: `qtyOf: 'Quantity of {name}'` / `'Cantidad de {name}'`. CSS: `.stepper-qty__n { width: 44px; height: 38px; border: 1px solid transparent; border-radius: 8px; background: transparent; text-align: center; font: inherit; font-weight: 700; font-size: 15px; color: var(--ink); }` `.stepper-qty__n:hover { border-color: var(--line); }` `.stepper-qty__n:focus { outline: none; border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-ring); }`.
- [ ] **Step 6:** typecheck + unit → pass. Commit `feat: type a quantity directly on an appliance card`.

### Task 4: E2E and verification

- [ ] **Step 1:** Add to `e2e/kit-builder.spec.ts`:

```ts
test('a condo can type 32 cameras, and the AC list is grouped by compressor type', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Security' }).click()
  await page.getByRole('button', { name: 'Add one CCTV camera' }).click()
  const field = page.getByRole('textbox', { name: 'Quantity of CCTV camera' })
  await field.fill('32')
  await field.press('Enter')
  await expect(field).toHaveValue('32')
  await expect(page.getByText(/· 3[0-9] appliances ·/)).toBeVisible()
  await page.getByRole('button', { name: 'Air conditioning' }).click()
  const headers = page.getByRole('heading', { level: 3 })
  await expect(headers).toHaveText(['Inverter', 'Conventional'])
  await expect(page.getByText('1 ton · 12k BTU')).toHaveCount(2)
})
```
  (Check the actual `addOne` label text and default appliance count before relying on these strings; adjust the footer assertion to the exact expected count.)
- [ ] **Step 2:** `npm run typecheck && npm run test:coverage && CI=true npm run e2e` → all pass.
- [ ] **Step 3:** Screenshot phone (375) and desktop (1280) of the AC filter and Security filter, en and es.
- [ ] **Step 4:** Commit `test: e2e for typed camera count and grouped AC list`.
