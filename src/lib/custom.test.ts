import { describe, expect, test } from 'vitest'
import { CUSTOM_NAME_MAX, EMPTY_FORM, isCustomLoadId, parseCustom, type CustomForm } from './custom'
import { CustomLoadSchema, ProjectSchema } from './schema'

describe('parseCustom', () => {
  test('multiplies volts by amps and keeps an explicit surge', () => {
    const r = parseCustom({ ...EMPTY_FORM, name: 'Pool pump', mode: 'va', volts: '230', amps: '4.5', surge: '2500' }, [])
    expect(r).toEqual({ ok: true, item: { id: 'custom1', name: 'Pool pump', watts: 1035, surge: 2500, note: 'Custom · 230 V × 4.5 A' } })
  })

  test('uses watts directly and defaults surge to running watts', () => {
    const r = parseCustom({ ...EMPTY_FORM, name: ' Heater ', mode: 'watts', watts: '750' }, ['custom1'])
    expect(r).toEqual({ ok: true, item: { id: 'custom2', name: 'Heater', watts: 750, surge: 750, note: 'Custom · 750 W' } })
  })

  test('rejects an empty name', () => {
    expect(parseCustom({ ...EMPTY_FORM, watts: '100' }, [])).toEqual({ ok: false, error: 'errName' })
  })

  test('rejects zero or non-numeric values per mode', () => {
    expect(parseCustom({ ...EMPTY_FORM, name: 'X', mode: 'va', volts: '0', amps: '2' }, [])).toEqual({ ok: false, error: 'errVa' })
    expect(parseCustom({ ...EMPTY_FORM, name: 'X', mode: 'watts', watts: 'abc' }, [])).toEqual({ ok: false, error: 'errWatts' })
  })

  test('rejects a surge below running watts', () => {
    expect(parseCustom({ ...EMPTY_FORM, name: 'X', watts: '500', surge: '100' }, [])).toEqual({ ok: false, error: 'errSurge' })
  })

  test('a name is kept to the length a saved project allows', () => {
    const longest = 'x'.repeat(CUSTOM_NAME_MAX)
    expect(parseCustom({ ...EMPTY_FORM, name: longest, watts: '180' }, [])).toMatchObject({ ok: true, item: { name: longest } })
    expect(parseCustom({ ...EMPTY_FORM, name: `${longest}x`, watts: '180' }, [])).toEqual({ ok: false, error: 'errNameLong' })
    // Spaces around the name do not count against it.
    expect(parseCustom({ ...EMPTY_FORM, name: `  ${longest}  `, watts: '180' }, [])).toMatchObject({ ok: true })
    const pasted = 'Samsung 21 cu. ft. Top Freezer Refrigerator with FlexZone and Ice Maker in Stainless Steel RT21M6215SR'
    expect(parseCustom({ ...EMPTY_FORM, name: pasted, watts: '180' }, [])).toEqual({ ok: false, error: 'errNameLong' })
  })

  test('a load that rounds to zero watts is refused, in either mode', () => {
    expect(parseCustom({ ...EMPTY_FORM, name: 'Standby LED', watts: '0.4' }, [])).toEqual({ ok: false, error: 'errWatts' })
    expect(parseCustom({ ...EMPTY_FORM, name: 'USB sensor', mode: 'va', volts: '5', amps: '0.08' }, [])).toEqual({ ok: false, error: 'errVa' })
    expect(parseCustom({ ...EMPTY_FORM, name: 'Half watt', watts: '0.5' }, [])).toMatchObject({ ok: true, item: { watts: 1, surge: 1 } })
  })

  test('volts × amps too large for a number are refused, not stored as Infinity', () => {
    expect(parseCustom({ ...EMPTY_FORM, name: 'Typo', mode: 'va', volts: '1e200', amps: '1e200' }, [])).toEqual({ ok: false, error: 'errVa' })
    expect(parseCustom({ ...EMPTY_FORM, name: 'Typo', mode: 'va', volts: '1e308', amps: '10' }, [])).toEqual({ ok: false, error: 'errVa' })
  })

  test('watts typed with a thousands separator are questioned instead of being read as a decimal', () => {
    // "1.500" is 1,500 as written in much of Latin America; read as a decimal it would be stored as 2 W.
    for (const watts of ['1.500', '12.000', '1.250.000', '1,500']) {
      expect(parseCustom({ ...EMPTY_FORM, name: 'Heater', watts }, [])).toEqual({ ok: false, error: 'errThousands' })
    }
    expect(parseCustom({ ...EMPTY_FORM, name: 'Heater', watts: '1500', surge: '2.500' }, [])).toEqual({ ok: false, error: 'errThousands' })
    expect(parseCustom({ ...EMPTY_FORM, name: 'Heater', watts: '1500' }, [])).toMatchObject({ ok: true, item: { watts: 1500 } })
    expect(parseCustom({ ...EMPTY_FORM, name: 'Charger', watts: '1.5' }, [])).toMatchObject({ ok: true, item: { watts: 2 } })
    // Amps are a real decimal: 1.500 A is one and a half amps.
    expect(parseCustom({ ...EMPTY_FORM, name: 'Pump', mode: 'va', volts: '230', amps: '1.500' }, [])).toMatchObject({ ok: true, item: { watts: 345 } })
  })
})

describe('isCustomLoadId', () => {
  test('knows the ids the form hands out from the ids a catalog appliance can have', () => {
    expect(['custom1', 'custom12'].every(isCustomLoadId)).toBe(true)
    expect(['custom', 'customer1', 'xcustom1', 'custom1b', 'fridge', ''].some(isCustomLoadId)).toBe(false)
  })

  test('every id parseCustom makes is one', () => {
    const made = parseCustom({ ...EMPTY_FORM, name: 'Pump', watts: '100' }, ['custom1', 'custom2'])
    expect(made.ok && isCustomLoadId(made.item.id)).toBe(true)
  })
})

describe('whatever the form accepts, a saved project accepts', () => {
  /** A small seeded generator (mulberry32), so a failing form can be reproduced. */
  function generator(seed: number) {
    let a = seed
    return () => {
      a = (a + 0x6D2B79F5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const NUMBERS = ['', '0', '0.4', '0.49', '0.5', '0.51', '1', '1.5', '1.500', '12.000', '1,5', '1,500', '750', '1500', '1e3', '1e-3', '1e200', '1e308', '1e400', '-5', 'abc', ' 12 ', 'Infinity', 'NaN', '0x10', '007', '.5', '5.', '99999999']
  const NAMES = ['', ' ', 'Pump', ' Heater ', 'x'.repeat(79), 'x'.repeat(80), 'x'.repeat(81), 'x'.repeat(300), `  ${'y'.repeat(80)}  `, '=HYPERLINK("x")', 'Niño 🚿', '\t\n']

  test('2,000 random forms: every accepted load passes the store schema, alone and inside a project', () => {
    const next = generator(20261012)
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!
    let accepted = 0
    for (let i = 0; i < 2000; i++) {
      const form: CustomForm = { name: pick(NAMES), mode: next() < 0.5 ? 'watts' : 'va', watts: pick(NUMBERS), volts: pick(NUMBERS), amps: pick(NUMBERS), surge: pick(NUMBERS) }
      const result = parseCustom(form, ['custom1'])
      if (!result.ok) continue
      accepted++
      expect(CustomLoadSchema.safeParse(result.item).success, JSON.stringify(form)).toBe(true)
      const project = { id: 'p1', name: 'Home', qty: { [result.item.id]: 1 }, custom: [result.item], hours: 10, volts: 48, chemistry: 'lifepo4' }
      expect(ProjectSchema.parse(project).custom, JSON.stringify(form)).toEqual([result.item])
    }
    expect(accepted).toBeGreaterThan(100)
  })
})
