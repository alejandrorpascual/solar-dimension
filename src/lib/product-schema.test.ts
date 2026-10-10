import { describe, expect, test } from 'vitest'
import { ProductInputSchema, brandKey, parseProducts, productKey } from './product-schema'
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

  test.each([
    ['maxParallelUnits', inverter({ maxParallelUnits: stated(2.5, 'Up to 2.5 units') })],
    ['maxParallel', battery({ maxParallel: stated(2.5, 'Up to 2.5 in parallel') })],
    ['cycleLife', battery({ cycleLife: stated(6000.5, '6000.5 cycles') })],
  ])('%s is a whole number', (field, product) => {
    const result = ProductInputSchema.safeParse(product)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([`specs.${field}.value`])
  })

  test('accepts a fractional kWh, Ah and warranty, which are measures and not counts', () => {
    const p = battery({ kWh: stated(5.12, '5.12kWh'), ah: stated(99.5, '99.5Ah'), warrantyYears: stated(2.5, '2.5 year warranty') })
    expect(ProductInputSchema.safeParse(p).success).toBe(true)
  })

  test.each(['brand', 'model'] as const)('refuses a %s with no letters or digits', (field) => {
    const result = ProductInputSchema.safeParse({ ...inverter(), [field]: '—' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([field])
  })
})

describe('productKey', () => {
  const key = (brand: string, model = '6000XP', kind: 'inverter' | 'battery' = 'inverter') => productKey({ kind, brand, model })

  test.each([
    ['EG4', 'EG4 Electronics'],
    ['Fox ESS', 'FoxESS'],
    ['Sol-Ark', 'Sol Ark'],
    ['Sol Ark', 'SolArk'],
    ['Big Battery', 'BigBattery'],
    ['Victron', 'Victron Energy'],
    ['MPP Solar', 'MPPSolar'],
    ['PYTES Energy', 'Pytes'],
    ['LG', 'LG Energy Solution'],
    ['Énergie X', 'Energie-X'],
    ['Discover Energy Systems', 'Discover'],
    ['Battle Born Batteries', 'Battle Born'],
  ])('%s and %s are one maker', (a, b) => {
    expect(key(a)).toBe(key(b))
  })

  test.each([
    ['Power Queen', 'Power Sonic'],
    ['Sol-Ark', 'Solis'],
    ['Fox ESS', 'Fox'],
  ])('%s and %s are two makers, even with the same model', (a, b) => {
    expect(key(a, '12V 100Ah', 'battery')).not.toBe(key(b, '12V 100Ah', 'battery'))
  })

  test.each([
    ['inverter', 'EG4 Electronics', '6000XP', 'inverter:eg4:6000xp'],
    ['battery', 'Pytes', 'V5', 'battery:pytes:v5'],
    ['inverter', 'E2E Power', 'X123', 'inverter:e2e:x123'],
    ['inverter', 'EG4', '18kPV-12LV', 'inverter:eg4:18kpv12lv'],
    ['battery', 'Big Battery', '48V KONG', 'battery:big:48vkong'],
    ['inverter', 'SMA Solar Technology', 'Sunny Island', 'inverter:sma:sunnyisland'],
    ['battery', 'LG Energy Solution', 'RESU10H', 'battery:lg:resu10h'],
    ['battery', 'Batería Ñ', 'Módulo 5', 'battery:baterian:modulo5'],
  ] as const)('%s brand %s with model %s gives %s', (kind, brand, model, expected) => {
    expect(key(brand, model, kind)).toBe(expected)
  })

  test.each([
    ['Fox ESS', 'FoxESS H1-5.0', 'FoxESS', 'H1-5.0'],
    ['Big Battery', 'BigBattery 48V KONG', 'BigBattery', '48V KONG'],
    ['EG4 Electronics', 'EG4 6000XP', 'EG4', '6000XP'],
    ['Pytes', 'Pytes V5', 'Pytes', 'V5'],
    ['Sol-Ark', 'Sol Ark 15K', 'SolArk', '15K'],
  ])('a repeated brand at the start of the model is dropped: %s + %s is %s + %s', (brandA, modelA, brandB, modelB) => {
    expect(key(brandA, modelA)).toBe(key(brandB, modelB))
  })

  test('the foxess model keeps its letters once the brand is removed', () => {
    expect(key('Fox ESS', 'FoxESS H1-5.0')).toBe('inverter:foxess:h150')
  })

  test('a model that is only the brand is kept whole', () => {
    expect(key('Pytes', 'Pytes')).toBe('inverter:pytes:pytes')
  })

  test('a brand that is only a generic word stays as it is', () => {
    expect(key('Power')).toBe('inverter:power:6000xp')
    expect(key('Energy Power')).toBe('inverter:energy:6000xp')
  })

  test('a generic word is never stripped down to fewer than two characters', () => {
    expect(key('A Power')).toBe('inverter:apower:6000xp')
    expect(key('AB Power')).toBe('inverter:ab:6000xp')
  })

  test('the kind is part of the key', () => {
    expect(key('EG4', '6000XP', 'battery')).not.toBe(key('EG4', '6000XP', 'inverter'))
  })
})

describe('brandKey', () => {
  test.each([
    ['EG4 Electronics', 'eg4'],
    ['Fox ESS', 'foxess'],
    ['Big Battery', 'big'],
    ['LG Energy Solution', 'lg'],
    ['Power', 'power'],
    ['Sungrow Power Supply', 'sungrowpowersupply'],
    ['—', ''],
  ])('%s gives %s', (brand, expected) => {
    expect(brandKey(brand)).toBe(expected)
  })
})

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
