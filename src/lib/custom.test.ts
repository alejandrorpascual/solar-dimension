import { describe, expect, test } from 'vitest'
import { EMPTY_FORM, parseCustom } from './custom'

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
})
