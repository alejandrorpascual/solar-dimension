import { describe, expect, test } from 'vitest'
import { mergeProduct, summarize } from './product-merge'
import { battery, inverter, NONE, SHEET, stated } from './product-fixtures'
import { productKey, type ProductInput, type ProductRecord } from './product-schema'

const NOW = '2026-10-09T12:00:00.000Z'
const record = (p: ProductInput, conflicts: ProductRecord['conflicts'] = []): ProductRecord =>
  ({ ...p, id: 'id-1', key: productKey(p), origin: 'admin', conflicts, retired: false })
const merge = (stored: ProductRecord | null, incoming: ProductInput, replace = false) => mergeProduct(stored, incoming, { replace, now: NOW })
const extraLine = (name: string, value: string) => ({ name, value, source: SHEET })
const OLD = '2026-10-01T00:00:00.000Z'
const PRICE = { amount: 1199, currency: 'USD', seller: 'Shop', url: 'https://shop.example.com/p', seenOn: '2026-10-09' }

describe('mergeProduct', () => {
  test('a new key is stored as sent', () => {
    const out = merge(null, inverter())
    expect(out.change).toEqual({ key: 'inverter:eg4:6000xp', kind: 'inverter', brand: 'EG4 Electronics', model: '6000XP', status: 'new', fills: [], replaced: [], cleared: [], conflicts: [], dropped: [] })
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
    expect(out.change).toMatchObject({ status: 'updated', replaced: [{ field: 'specs.continuousW', stored: 6000, found: 5000 }], conflicts: [] })
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

  test('a price on a product without one is a fill', () => {
    const out = merge(record(inverter()), { ...inverter(), price: PRICE })
    expect(out.change).toMatchObject({ status: 'updated', fills: ['price'], replaced: [] })
    expect(out.next.price).toEqual(PRICE)
  })

  test('a different price takes the old one’s place without replace and is reported as replaced', () => {
    const cheaper = { ...PRICE, amount: 1099, seenOn: '2026-10-10' }
    const out = merge(record({ ...inverter(), price: PRICE }), { ...inverter(), price: cheaper })
    expect(out.change).toMatchObject({ status: 'updated', fills: [], replaced: [{ field: 'price', stored: PRICE, found: cheaper }], conflicts: [] })
    expect(out.next.price).toEqual(cheaper)
  })

  test('the same price again is unchanged', () => {
    const out = merge(record({ ...inverter(), price: PRICE }), { ...inverter(), price: { ...PRICE } })
    expect(out.change).toMatchObject({ status: 'unchanged', fills: [], replaced: [] })
  })

  test('a write with no price keeps the stored price', () => {
    const out = merge(record({ ...inverter(), price: PRICE }), inverter())
    expect(out.change.status).toBe('unchanged')
    expect(out.next.price).toEqual(PRICE)
  })

  test('replaced carries the stored and found levels of a surge list', () => {
    const levels = [{ w: 9000, seconds: 5, asWritten: '9 kW 5 s', source: SHEET }]
    const out = merge(record(inverter()), inverter({ surges: levels }), true)
    expect(out.change.replaced).toEqual([{ field: 'specs.surges', stored: inverter().specs.surges, found: levels }])
  })

  test('a conflict seen again is not stored twice', () => {
    const seen = { field: 'specs.continuousW', found: 5000, source: SHEET, seenAt: '2026-10-01T00:00:00.000Z' }
    const out = merge(record(inverter(), [seen]), inverter({ continuousW: stated(5000, '5000W') }))
    expect(out.conflicts).toEqual([seen])
  })

  test('two incoming lines with one new name add it once', () => {
    const incoming = { ...inverter(), extraSpecs: [extraLine('Weight', '24 kg'), extraLine('weight', '25 kg')] }
    const out = merge(record(inverter()), incoming)
    expect(out.change.fills).toEqual(['extraSpecs.Weight'])
    expect(out.next.extraSpecs).toEqual([extraLine('Weight', '24 kg')])
  })

  test('replace with the stored value clears that field’s conflicts', () => {
    const old = { field: 'specs.continuousW', found: 5500, source: SHEET, seenAt: OLD }
    const out = merge(record(inverter(), [old]), inverter({ continuousW: stated(6000, '6000W') }), true)
    expect(out.change).toMatchObject({ status: 'updated', cleared: ['specs.continuousW'], fills: [], replaced: [], conflicts: [] })
    expect(out.next.kind === 'inverter' && out.next.specs.continuousW.value).toBe(6000)
    expect(out.conflicts).toEqual([])
  })

  test('replace with the stored value and no stored conflict is unchanged', () => {
    const out = merge(record(inverter()), inverter({ continuousW: stated(6000, '6000W') }), true)
    expect(out.change).toMatchObject({ status: 'unchanged', cleared: [], fills: [], replaced: [], conflicts: [] })
    expect(out.conflicts).toEqual([])
  })

  test('a replaced field with a stored conflict is also reported cleared', () => {
    const old = { field: 'specs.continuousW', found: 5500, source: SHEET, seenAt: OLD }
    const out = merge(record(inverter(), [old]), inverter({ continuousW: stated(5000, '5000W') }), true)
    expect(out.change).toMatchObject({ replaced: [{ field: 'specs.continuousW', stored: 6000, found: 5000 }], cleared: ['specs.continuousW'] })
  })

  test('a stored row missing a spec key takes the incoming value as a fill', () => {
    const { idleW: _omitted, ...rest } = inverter().specs
    const stored = record({ ...inverter(), specs: rest as ReturnType<typeof inverter>['specs'] })
    const out = merge(stored, inverter({ idleW: stated(40, '40W idle') }))
    expect(out.change).toMatchObject({ status: 'updated', fills: ['specs.idleW'], conflicts: [] })
    expect(out.next.kind === 'inverter' && out.next.specs.idleW.value).toBe(40)
  })

  test('surge levels compare in any order', () => {
    const reversed = [...inverter().specs.surges].reverse()
    expect(merge(record(inverter()), inverter({ surges: reversed })).change.status).toBe('unchanged')
  })

  test('replace on an extra line keeps the stored name', () => {
    const stored = record({ ...inverter(), extraSpecs: [extraLine('IP rating', 'IP20')] })
    const out = merge(stored, { ...inverter(), extraSpecs: [extraLine('ip rating', 'IP65')] }, true)
    expect(out.change).toMatchObject({ status: 'updated', replaced: [{ field: 'extraSpecs.IP rating', stored: 'IP20', found: 'IP65' }] })
    expect(out.next.extraSpecs[0]).toEqual({ name: 'IP rating', value: 'IP65', source: SHEET })
  })

  test('makerUrl fills a stored null', () => {
    const out = merge(record(inverter()), { ...inverter(), makerUrl: 'https://eg4.example.com' })
    expect(out.change).toMatchObject({ status: 'updated', fills: ['makerUrl'] })
    expect(out.next.makerUrl).toBe('https://eg4.example.com')
  })

  test('a different makerUrl is a conflict unless replacing', () => {
    const stored = record({ ...inverter(), makerUrl: 'https://eg4.example.com' })
    const incoming = { ...inverter(), makerUrl: 'https://eg4electronics.example.com' }
    const kept = merge(stored, incoming)
    expect(kept.change).toMatchObject({ status: 'conflicts', conflicts: [{ field: 'makerUrl', stored: 'https://eg4.example.com', found: 'https://eg4electronics.example.com' }] })
    expect(kept.next.makerUrl).toBe('https://eg4.example.com')
    const replaced = merge(stored, incoming, true)
    expect(replaced.change).toMatchObject({ status: 'updated', replaced: [{ field: 'makerUrl', stored: 'https://eg4.example.com', found: 'https://eg4electronics.example.com' }] })
    expect(replaced.next.makerUrl).toBe('https://eg4electronics.example.com')
  })

  test('a list conflict records the values as found', () => {
    const out = merge(record(battery({ compatibleInverterBrands: ['Victron'] })), battery({ compatibleInverterBrands: ['Growatt'] }))
    expect(out.change.conflicts).toEqual([{ field: 'specs.compatibleInverterBrands', stored: ['Victron'], found: ['Growatt'] }])
    expect(out.conflicts).toEqual([{ field: 'specs.compatibleInverterBrands', found: ['Growatt'], source: null, seenAt: NOW }])
  })

  test('a surge conflict records the levels as found', () => {
    const levels = [{ w: 9000, seconds: 5, asWritten: '9 kW 5 s', source: SHEET }]
    const out = merge(record(inverter()), inverter({ surges: levels }))
    expect(out.change.conflicts).toEqual([{ field: 'specs.surges', stored: inverter().specs.surges, found: levels }])
    expect(out.conflicts).toEqual([{ field: 'specs.surges', found: levels, source: SHEET, seenAt: NOW }])
  })

  test('a list conflict seen again in other casing is not stored twice', () => {
    const seen = { field: 'specs.compatibleInverterBrands', found: ['Growatt'], source: null, seenAt: OLD }
    const out = merge(record(battery({ compatibleInverterBrands: ['Victron'] }), [seen]), battery({ compatibleInverterBrands: ['growatt'] }))
    expect(out.conflicts).toEqual([seen])
  })
})

describe('mergeProduct extra lines past the cap', () => {
  const lines = (names: string[]) => names.map((n) => extraLine(n, 'x'))
  const full = (n: number) => lines(Array.from({ length: n }, (_, i) => `L${i}`))

  test('new lines that do not fit are listed as dropped and leave the status unchanged', () => {
    // Arrange
    const stored = record({ ...inverter(), extraSpecs: full(8) })
    // Act
    const out = merge(stored, { ...inverter(), extraSpecs: lines(['Weight', 'IP rating']) })
    // Assert
    expect(out.change).toMatchObject({ status: 'unchanged', fills: [], dropped: ['extraSpecs.Weight', 'extraSpecs.IP rating'] })
    expect(out.next.extraSpecs).toEqual(full(8))
  })

  test('a product with room for some of the new lines fills those and drops the rest', () => {
    const stored = record({ ...inverter(), extraSpecs: full(7) })
    const out = merge(stored, { ...inverter(), extraSpecs: lines(['Weight', 'IP rating', 'Size']) })
    expect(out.change).toMatchObject({ status: 'updated', fills: ['extraSpecs.Weight'], dropped: ['extraSpecs.IP rating', 'extraSpecs.Size'] })
    expect(out.next.extraSpecs).toHaveLength(8)
  })

  test('a name sent twice is dropped once', () => {
    const stored = record({ ...inverter(), extraSpecs: full(8) })
    const out = merge(stored, { ...inverter(), extraSpecs: lines(['Weight', 'weight']) })
    expect(out.change.dropped).toEqual(['extraSpecs.Weight'])
  })

  test('lines that fit, and known names at the cap, drop nothing', () => {
    const stored = record({ ...inverter(), extraSpecs: full(8) })
    expect(merge(stored, { ...inverter(), extraSpecs: lines(['l0']) }).change.dropped).toEqual([])
    expect(merge(record(inverter()), { ...inverter(), extraSpecs: lines(['Weight']) }).change.dropped).toEqual([])
  })
})

describe('summarize', () => {
  const KEY = 'inverter:eg4:6000xp'

  test('lists a product that fills one field and conflicts on another under updated and under conflicts', () => {
    // Arrange
    const stored = record(inverter({ chargerA: NONE }))
    const incoming = inverter({ chargerA: stated(125, 'MAX. CHARGE CURRENT 125A'), continuousW: stated(5000, '5000W') })
    // Act
    const out = summarize([merge(stored, incoming).change])
    // Assert
    expect(out).toEqual({ created: [], updated: [KEY], unchanged: [], conflicts: [{ key: KEY, fields: ['specs.continuousW'] }] })
  })

  test('lists a product that only conflicts under conflicts alone', () => {
    const out = summarize([merge(record(inverter()), inverter({ continuousW: stated(5000, '5000W') })).change])
    expect(out).toEqual({ created: [], updated: [], unchanged: [], conflicts: [{ key: KEY, fields: ['specs.continuousW'] }] })
  })

  test('sorts new, filled and untouched products into created, updated and unchanged', () => {
    const created = merge(null, battery()).change
    const updated = merge(record(inverter({ chargerA: NONE })), inverter({ chargerA: stated(125, 'MAX. CHARGE CURRENT 125A') })).change
    const unchanged = merge(record(battery({ kWh: stated(5.12, '5.12kWh') })), battery()).change
    expect(summarize([created, updated, unchanged])).toEqual({
      created: ['battery:pytes:v5'], updated: [KEY], unchanged: ['battery:pytes:v5'], conflicts: [],
    })
  })

  test('gives an empty summary for no changes', () => {
    expect(summarize([])).toEqual({ created: [], updated: [], unchanged: [], conflicts: [] })
  })
})
