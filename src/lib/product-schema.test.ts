import { describe, expect, test } from 'vitest'
import { ProductInputSchema, brandKey, parseProducts, productKey } from './product-schema'
import { NONE, battery, inverter, stated } from './product-fixtures'

describe('ProductInputSchema', () => {
  test('accepts an inverter and a battery as the datasheet states them', () => {
    expect(ProductInputSchema.safeParse(inverter()).success).toBe(true)
    expect(ProductInputSchema.safeParse(battery()).success).toBe(true)
  })

  test.each([
    ['neither its source nor its words', { value: 6000, source: null, asWritten: null }],
    ['no source', { value: 6000, source: null, asWritten: 'NOMINAL POWER OUTPUT 6000W' }],
    ['no words as written', { value: 6000, source: 'https://example.com/sheet.pdf', asWritten: null }],
  ])('a stated value with %s is refused at the path of that spec', (_, continuousW) => {
    const result = ProductInputSchema.safeParse(inverter({ continuousW }))
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['specs.continuousW'])
  })

  test('a spec the datasheet does not give is all null', () => {
    expect(ProductInputSchema.safeParse(inverter({ continuousW: NONE })).success).toBe(true)
  })

  test.each([
    ['missing', undefined],
    ['null', null],
    ['not a URL', 'datasheet.pdf'],
  ])('a datasheet link that is %s is refused at datasheetUrl', (_, datasheetUrl) => {
    const { datasheetUrl: _omitted, ...withoutSheet } = inverter()
    const result = ProductInputSchema.safeParse(datasheetUrl === undefined ? withoutSheet : { ...withoutSheet, datasheetUrl })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['datasheetUrl'])
  })

  test('accepts a surge level the maker gives only in VA (no watts)', () => {
    const level = { w: null, seconds: 5, asWritten: '12 kVA for 5 seconds', source: 'https://example.com/sheet.pdf' }
    expect(ProductInputSchema.safeParse(inverter({ surges: [level] })).success).toBe(true)
  })

  test('refuses a key it does not know at the top level', () => {
    const result = ProductInputSchema.safeParse({ ...inverter(), colour: 'red' })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toMatchObject([{ code: 'unrecognized_keys', keys: ['colour'], path: [] }])
  })

  test('refuses a key it does not know inside specs', () => {
    const result = ProductInputSchema.safeParse({ ...inverter(), specs: { ...inverter().specs, wifi: NONE } })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toMatchObject([{ code: 'unrecognized_keys', keys: ['wifi'], path: ['specs'] }])
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

  test.each([
    ['in another case', 'Weight', 'weight'],
    ['with spaces around it', 'Weight', '  Weight '],
  ])('refuses two extra lines with one name written %s, at extraSpecs', (_, first, second) => {
    // Arrange: a new product never goes through the merge, so only the schema can stop a repeated name.
    const line = (name: string, value: string) => ({ name, value, source: 'https://example.com/sheet.pdf' })
    const p = { ...inverter(), extraSpecs: [line(first, '52 kg'), line(second, '115 lb')] }

    // Act
    const result = ProductInputSchema.safeParse(p)

    // Assert
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['extraSpecs'])
  })

  test('accepts extra lines with different names', () => {
    const line = (name: string, value: string) => ({ name, value, source: 'https://example.com/sheet.pdf' })
    const p = { ...inverter(), extraSpecs: [line('Weight', '52 kg'), line('Net weight', '50 kg')] }
    expect(ProductInputSchema.safeParse(p).success).toBe(true)
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
  const models = (count: number) => Array.from({ length: count }, (_, i) => ({ ...inverter(), model: `M${i}` }))
  const noDatasheet = () => ({ ...inverter(), datasheetUrl: null })

  test('takes one product as well as an array', () => {
    expect(parseProducts(inverter())).toMatchObject({ ok: true, items: [expect.objectContaining({ model: '6000XP' })] })
    expect(parseProducts([inverter(), battery()])).toMatchObject({ ok: true, items: [{ model: '6000XP' }, { model: 'V5' }] })
  })

  test('accepts a batch of 50', () => {
    const out = parseProducts(models(50))
    expect(out.ok && out.items).toHaveLength(50)
  })

  test.each([
    ['an empty batch', 0],
    ['a batch of 51', 51],
  ])('refuses %s with one error at index -1', (_, size) => {
    expect(parseProducts(models(size))).toEqual({
      ok: false, errors: [{ index: -1, issues: [{ path: '', message: 'send 1 to 50 products' }] }],
    })
  })

  test('reports issues per index with a dotted path', () => {
    const bad = inverter({ continuousW: { value: 6000, source: null, asWritten: null } })
    const out = parseProducts([battery(), bad])
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.errors[0]!.index).toBe(1)
    expect(out.errors[0]!.issues[0]!.path).toBe('specs.continuousW')
  })

  test.each([
    ['verification', { status: 'verified', by: 'token', at: '2026-10-25T00:00:00.000Z' }],
    ['verifiedAt', '2026-10-25T00:00:00.000Z'],
    ['verifiedBy', 'token'],
  ])('refuses a product that sets %s: only an admin verifies', (field, value) => {
    const out = parseProducts([{ ...inverter(), [field]: value }])
    expect(out).toMatchObject({ ok: false, errors: [{ index: 0, issues: [expect.objectContaining({ message: expect.stringContaining(field) })] }] })
  })

  test('gives one entry per bad item, all of an item\'s issues in its entry', () => {
    const twoIssues = { ...noDatasheet(), makerUrl: 'http://example.com' }
    const out = parseProducts([battery(), noDatasheet(), inverter(), twoIssues])
    expect(out).toMatchObject({ ok: false, errors: [{ index: 1 }, { index: 3 }] })
    if (out.ok) return
    expect(out.errors).toHaveLength(2)
    expect(out.errors[0]!.issues.map((i) => i.path)).toEqual(['datasheetUrl'])
    expect(out.errors[1]!.issues.map((i) => i.path).sort()).toEqual(['datasheetUrl', 'makerUrl'])
  })

  test('takes the fields to clear beside the product, and leaves clear off when none is sent', () => {
    const out = parseProducts([{ ...inverter({ chargerA: NONE }), clear: ['specs.chargerA', 'makerUrl', 'price', 'extraSpecs.Weight'] }, battery()])
    expect(out).toMatchObject({ ok: true, items: [{ clear: ['specs.chargerA', 'makerUrl', 'price', 'extraSpecs.Weight'] }, {}] })
    expect(out.ok && 'clear' in out.items[1]!).toBe(false)
  })

  test.each([
    ['a field it also states', 'specs.continuousW', 'clear.0: the product states specs.continuousW; send it unstated to clear it'],
    ['the datasheet', 'datasheetUrl', 'clear.0: datasheetUrl cannot be cleared; use specs.<name>, makerUrl, price or extraSpecs.<name>'],
    ['a spec its kind does not have', 'specs.kWh', 'clear.0: specs.kWh cannot be cleared; use specs.<name>, makerUrl, price or extraSpecs.<name>'],
  ])('refuses a clear of %s', (_, path, message) => {
    const out = parseProducts([{ ...inverter(), clear: [path] }])
    const [where, text] = message.split(': ')
    expect(out).toEqual({ ok: false, errors: [{ index: 0, issues: [{ path: where, message: text }] }] })
  })

  test('refuses a clear that is not a list of field names', () => {
    expect(parseProducts([{ ...inverter(), clear: 'price' }])).toMatchObject({ ok: false, errors: [{ index: 0, issues: [{ path: 'clear' }] }] })
  })

  test('refuses two items with the same key', () => {
    const out = parseProducts([inverter(), { ...inverter(), brand: 'EG4' }])
    expect(out).toMatchObject({ ok: false, errors: [{ index: 1, issues: [{ path: 'model', message: 'the same product twice in this request' }] }] })
  })

  test('sees one maker behind two spellings of its name as the same product', () => {
    const out = parseProducts([{ ...inverter(), brand: 'Fox ESS', model: 'H1-5.0' }, { ...inverter(), brand: 'FoxESS', model: 'FoxESS H1 5.0' }])
    expect(out).toMatchObject({ ok: false, errors: [{ index: 1 }] })
  })

  test('keeps two makers apart when their model names are the same', () => {
    const out = parseProducts([{ ...battery(), brand: 'Power Queen', model: '12V 100Ah' }, { ...battery(), brand: 'Power Sonic', model: '12V 100Ah' }])
    expect(out.ok).toBe(true)
  })
})
