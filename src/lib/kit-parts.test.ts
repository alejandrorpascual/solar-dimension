import { describe, expect, test } from 'vitest'
import { buildParts } from '../components/KitSummary'
import { getDictionary } from '../i18n'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { compute } from './sizing'
import { DEFAULT_QTY } from './store'

describe.each(['en', 'es'] as const)('kit parts (%s)', (locale) => {
  const t = getDictionary(locale)
  const result = (batteryUnit: string) => compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit }, CATALOG_SNAPSHOT)

  test('a single battery has no interconnect row in the shared screen/export parts', () => {
    const parts = buildParts(result('48-300'), t, locale)
    expect(parts.map(p => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'fuse'])
    expect(parts.every(p => Number(p.qty) > 0)).toBe(true)
  })

  test('a series-only bank does not mention zero parallel links', () => {
    const part = buildParts(result('12-200'), t, locale).find(p => p.id === 'interconnects')!
    expect(part.qty).toBe('3')
    expect(part.note).toBe(locale === 'es' ? '3 enlaces en serie' : '3 series links')
  })

  test('a parallel-only bank does not mention zero series links', () => {
    const part = buildParts(result('48-50'), t, locale).find(p => p.id === 'interconnects')!
    expect(part.qty).toBe('4')
    expect(part.note).toBe(locale === 'es' ? '4 puentes en paralelo' : '4 parallel jumpers')
  })
})
