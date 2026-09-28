import { describe, expect, test } from 'vitest'
import { CATEGORIES } from './catalog'
import { APPLIANCE_CATEGORIES, ApplianceSchema, applianceWarnings, idTakenMessage, parseItems, slugify, toCatalogItem, type ApplianceInput } from './catalog-schema'
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
    ['a custom-load-shaped id', { id: 'custom1' }],
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
  test('reserves custom-load-shaped ids with a specific message', () => {
    const result = ApplianceSchema.safeParse({ ...stove, id: 'custom12' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'id' && i.message === 'ids like "custom1" are reserved for custom loads')).toBe(true)
    }
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
  test('rejects a duplicate id in the same request instead of crashing the upsert', () => {
    const r = parseItems([stove, { ...stove }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toEqual([{ index: 1, issues: [{ path: 'id', message: 'duplicate id in this request' }] }])
  })
  test('flags every repeat after the first when an id appears more than twice', () => {
    const r = parseItems([stove, { ...stove }, { ...stove }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.map((e) => e.index)).toEqual([1, 2])
  })
})

describe('applianceWarnings', () => {
  test('flags very large loads and nonstop heavy loads, and nothing for ordinary ones', () => {
    expect(applianceWarnings(stove)).toEqual([])
    expect(applianceWarnings({ ...stove, watts: 7000, surge: 7000 })).toHaveLength(1)
    expect(applianceWarnings({ ...stove, duty: 1 })).toHaveLength(1)
  })
})

describe('idTakenMessage', () => {
  test('flags an id already in use and passes a free one', () => {
    const ids = new Set(['toaster', 'fridge'])
    expect(idTakenMessage('toaster', ids)).toBe('The id "toaster" is already used by another appliance. Change the English name.')
    expect(idTakenMessage('new-thing', ids)).toBeNull()
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
