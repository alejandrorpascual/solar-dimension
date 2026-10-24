import { describe, expect, test } from 'vitest'
import { CATEGORIES } from './catalog'
import { APPLIANCE_CATEGORIES, ApplianceSchema, applianceWarnings, idTakenMessage, momentaryDuty, parseItems, slugify, toCatalogItem, type ApplianceInput } from './catalog-schema'
import { APPLIANCE_SEED, APPLIANCE_SEED_MOMENTARY, CATALOG_SNAPSHOT } from './catalog-snapshot'

const stove: ApplianceInput = {
  id: 'induction-2', category: 'Kitchen', watts: 3500, surge: 3500, duty: 0.15, tons: null, acType: null,
  kind: null, surgeClass: null, burstSeconds: null, cyclesPerHour: null,
  labels: { en: { name: '2-burner induction cooktop', note: '' }, es: { name: 'Anafe de inducción de 2 hornillas', note: '' } },
}
const gate: ApplianceInput = { ...stove, id: 'gate', category: 'Security', watts: 550, surge: 1650, duty: 0.033, kind: 'momentary', surgeClass: 'motor', burstSeconds: 20, cyclesPerHour: 6 }

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
  test('load kind and surge class default to null when a client omits them', () => {
    const { kind: _k, surgeClass: _s, burstSeconds: _b, cyclesPerHour: _c, ...legacy } = stove
    expect(ApplianceSchema.parse(legacy)).toEqual(stove)
  })
  test('accepts a momentary load with its bursts, and rejects half-described or impossible ones', () => {
    expect(ApplianceSchema.safeParse(gate).success).toBe(true)
    expect(ApplianceSchema.safeParse({ ...gate, cyclesPerHour: null }).success).toBe(false)
    expect(ApplianceSchema.safeParse({ ...gate, kind: 'cycling' }).success).toBe(false)
    expect(ApplianceSchema.safeParse({ ...stove, burstSeconds: 5 }).success).toBe(false)
    expect(ApplianceSchema.safeParse({ ...gate, burstSeconds: 600, cyclesPerHour: 7 }).success).toBe(false)
    expect(ApplianceSchema.safeParse({ ...gate, cyclesPerHour: 121 }).success).toBe(false)
  })
  test('a continuous kind needs duty 1, and a surge class needs a surge', () => {
    expect(ApplianceSchema.safeParse({ ...stove, kind: 'continuous' }).success).toBe(false)
    expect(ApplianceSchema.safeParse({ ...stove, kind: 'continuous', duty: 1 }).success).toBe(true)
    expect(ApplianceSchema.safeParse({ ...stove, surgeClass: 'inrush' }).success).toBe(false)
    expect(ApplianceSchema.safeParse({ ...stove, surge: 4000, surgeClass: 'inrush' }).success).toBe(true)
  })
  test('accepts an item without sources, and one with sources for its figures', () => {
    const datasheet = { source: 'https://example.com/cooktop.pdf', asWritten: 'Rated power: 3500 W' }
    const review = { source: 'https://example.org/cooktop-review', asWritten: 'draws about 3.4 kW on full power' }

    expect(ApplianceSchema.parse(stove)).not.toHaveProperty('sources')
    expect(ApplianceSchema.parse({ ...stove, sources: { watts: [datasheet, review], surge: [datasheet] } }).sources)
      .toEqual({ watts: [datasheet, review], surge: [datasheet] })
    expect(ApplianceSchema.parse({ ...gate, sources: { duty: [review], burstSeconds: [datasheet], cyclesPerHour: [review] } }).sources)
      .toEqual({ duty: [review], burstSeconds: [datasheet], cyclesPerHour: [review] })
  })
  test('takes up to three sources for a figure, each with up to 200 characters as written', () => {
    const three = Array.from({ length: 3 }, (_, i) => ({ source: `https://example.com/${i}`, asWritten: 'W'.repeat(200) }))

    expect(ApplianceSchema.parse({ ...stove, sources: { watts: three } }).sources).toEqual({ watts: three })
  })
  test.each([
    ['a source that is not https', { watts: [{ source: 'http://example.com/cooktop.pdf', asWritten: '3500 W' }] }],
    ['201 characters as written', { watts: [{ source: 'https://example.com/cooktop.pdf', asWritten: 'W'.repeat(201) }] }],
    ['a source with a field besides the page and its words', { watts: [{ source: 'https://example.com/cooktop.pdf', asWritten: '3500 W', page: 2 }] }],
    ['a source without its words as written', { watts: [{ source: 'https://example.com/cooktop.pdf', asWritten: '  ' }] }],
    ['a figure with an empty list', { watts: [] }],
    ['four sources for one figure', { watts: Array.from({ length: 4 }, (_, i) => ({ source: `https://example.com/${i}`, asWritten: '3500 W' })) }],
    ['a field that is not a sourced figure', { tons: [{ source: 'https://example.com/cooktop.pdf', asWritten: '1 ton' }] }],
  ])('rejects sources with %s', (_, sources) => {
    expect(ApplianceSchema.safeParse({ ...stove, sources }).success).toBe(false)
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
  test('flags a surge over 10 times the running watts, and not one at 10 times', () => {
    const pump = { ...stove, id: 'pump', category: 'Utility' as const, watts: 100, duty: 0.1 }

    expect(applianceWarnings({ ...pump, surge: 3000 })).toEqual(['Surge is 30× the running watts: motors start at 2–3× and compressors under 10×. Check the surge is in watts.'])
    expect(applianceWarnings({ ...pump, surge: 1000 })).toEqual([])
    expect(applianceWarnings({ ...pump, surge: 1040 })).toEqual([expect.stringMatching(/^Surge is 10\.4× the running watts/)])
  })
  test('flags an air conditioner whose watts sit outside half to twice 1,100 W a ton', () => {
    const ac: ApplianceInput = { ...stove, id: 'ac1', category: 'Air conditioning', watts: 1100, surge: 1430, duty: 0.6, tons: 1, acType: 'inverter' }

    expect(applianceWarnings({ ...ac, watts: 110, surge: 143 })).toEqual(['110 W is outside 550–2200 W for 1 ton: check the tons and the running watts.'])
    expect(applianceWarnings({ ...ac, watts: 2201, surge: 2201 })).toHaveLength(1)
    expect(applianceWarnings({ ...ac, watts: 550 })).toEqual([])
    expect(applianceWarnings({ ...ac, watts: 2200 })).toEqual([])
    expect(applianceWarnings({ ...ac, tons: 1.5, watts: 800 })).toEqual(['800 W is outside 825–3300 W for 1.5 tons: check the tons and the running watts.'])
  })
  test('flags a momentary duty far from what its bursts imply', () => {
    expect(applianceWarnings(gate)).toEqual([])
    expect(applianceWarnings({ ...gate, duty: 0.5 })).toHaveLength(1)
    expect(momentaryDuty(gate)).toBeCloseTo(0.0333)
    expect(momentaryDuty(stove)).toBeNull()
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
  test('warns on no seeded row but the two 5-ton air conditioners, and only that they are over 5 kW', () => {
    const warned = [...APPLIANCE_SEED, ...APPLIANCE_SEED_MOMENTARY]
      .map((r) => ({ id: r.id, warnings: applianceWarnings(ApplianceSchema.parse(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'retired')))) }))
      .filter((r) => r.warnings.length > 0)

    expect(warned).toEqual([
      { id: 'ac5i', warnings: ['Over 5 kW: check this is one appliance, not a whole circuit.'] },
      { id: 'ac5c', warnings: ['Over 5 kW: check this is one appliance, not a whole circuit.'] },
    ])
  })
  test('adds three momentary Security loads after the recorders, valid and in order', () => {
    expect(APPLIANCE_SEED_MOMENTARY.map((r) => r.id)).toEqual(['gate-slide', 'gate-swing', 'barrier'])
    for (const r of APPLIANCE_SEED_MOMENTARY) {
      const input = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'retired'))
      expect(ApplianceSchema.safeParse(input).success, r.id).toBe(true)
      expect(applianceWarnings(ApplianceSchema.parse(input)), r.id).toEqual([])
    }
    const ids = CATALOG_SNAPSHOT.map((a) => a.id)
    expect(ids.slice(ids.indexOf('nvr32'), ids.indexOf('nvr32') + 5)).toEqual(['nvr32', 'gate-slide', 'gate-swing', 'barrier', 'cpap'])
    expect(CATALOG_SNAPSHOT.find((a) => a.id === 'barrier')).toMatchObject({ kind: 'momentary', surgeClass: 'motor', burstSeconds: 4, cyclesPerHour: 30 })
  })
  test('toCatalogItem maps a record to the engine shape, English name first', () => {
    const ac = CATALOG_SNAPSHOT.find((a) => a.id === 'ac2i')
    expect(ac).toMatchObject({ name: '2 ton AC · inverter', cat: 'Air conditioning', watts: 2200, surge: 2860, tons: 2, acType: 'inverter', retired: false })
    const fridge = toCatalogItem(APPLIANCE_SEED.find((r) => r.id === 'fridge')!)
    expect(fridge).not.toHaveProperty('tons')
    expect(fridge).not.toHaveProperty('acType')
    expect(fridge).not.toHaveProperty('kind')
    expect(fridge).not.toHaveProperty('surgeClass')
  })
})
