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
