import { describe, expect, test } from 'vitest'
import { ProductInputSchema, productKey } from './product-schema'
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

  test('refuses a model with no letters or digits', () => {
    expect(ProductInputSchema.safeParse({ ...inverter(), model: '—' }).success).toBe(false)
  })
})

describe('productKey', () => {
  test('one maker whatever the brand spelling', () => {
    expect(productKey({ kind: 'inverter', brand: 'EG4', model: '6000XP' }))
      .toBe(productKey({ kind: 'inverter', brand: 'EG4 Electronics', model: '6000XP' }))
  })

  test('ignores case, spaces, punctuation, accents and a repeated brand in the model', () => {
    expect(productKey({ kind: 'inverter', brand: 'EG4', model: '18kPV-12LV' })).toBe('inverter:eg4:18kpv12lv')
    expect(productKey({ kind: 'battery', brand: 'Pytes', model: 'Pytes V5' })).toBe('battery:pytes:v5')
    expect(productKey({ kind: 'battery', brand: 'Batería Ñ', model: 'Módulo 5' })).toBe('battery:bateria:modulo5')
  })

  test('the kind is part of the key', () => {
    expect(productKey({ kind: 'battery', brand: 'EG4', model: '6000XP' })).not.toBe(productKey({ kind: 'inverter', brand: 'EG4', model: '6000XP' }))
  })
})
