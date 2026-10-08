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

  test('a battery-only kit has no solar rows', () => {
    const parts = buildParts(result('48-200'), t, locale)
    expect(parts.some((p) => p.group === 'solar')).toBe(false)
  })

  test('panels add five tagged rows after the fuse, in order', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 40, panels: 10, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const parts = buildParts(r, t, locale)
    expect(parts.map((p) => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'fuse', 'solarPanels', 'chargeController', 'pvCable', 'pvDisconnect', 'mounting'])
    expect(parts.filter((p) => p.group === 'solar')).toHaveLength(5)
    const panels = parts.find((p) => p.id === 'solarPanels')!
    expect(panels.qty).toBe('10')
    expect(panels.spec).toBe(locale === 'es' ? '550 W monocristalino, 2.28 × 1.13 m' : '550 W monocrystalline, 2.28 × 1.13 m')
    expect(panels.note).toContain(locale === 'es' ? '2 cadenas de hasta 5 en serie' : '2 strings of up to 5 in series')
    expect(parts.find((p) => p.id === 'chargeController')!.qty).toBe('1')
    expect(parts.find((p) => p.id === 'chargeController')!.spec).toContain('MPPT 100 A')
    expect(parts.find((p) => p.id === 'pvCable')!.qty).toBe('2')
    expect(parts.find((p) => p.id === 'pvDisconnect')!.spec).toContain('40 A')
  })

  test('zero panels adds no solar rows even with the step turned on', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: 0, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(buildParts(r, t, locale).some((p) => p.group === 'solar')).toBe(false)
  })
})
