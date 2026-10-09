import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { buildParts } from './kit-parts'
import { compute } from './sizing'
import { DEFAULT_QTY } from './store'

describe.each(['en', 'es'] as const)('kit parts (%s)', (locale) => {
  const t = getDictionary(locale)
  const result = (batteryUnit: string) => compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit }, CATALOG_SNAPSHOT)

  test('a single battery has no interconnect or string-fuse row in the shared screen/export parts', () => {
    const parts = buildParts(result('48-300'), t, locale)
    expect(parts.map(p => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'fuse'])
    expect(parts.every(p => Number(p.qty) > 0)).toBe(true)
  })

  test('a series-only bank does not mention zero parallel links', () => {
    const part = buildParts(result('12-200'), t, locale).find(p => p.id === 'interconnects')!
    expect(part.qty).toBe('3')
    expect(part.note).toBe(locale === 'es' ? '3 enlaces en serie' : '3 series links')
  })

  test('a parallel-only bank does not mention zero series links, and gets a fuse per string', () => {
    const parts = buildParts(result('48-50'), t, locale)
    const links = parts.find(p => p.id === 'interconnects')!
    expect(links.qty).toBe('4')
    expect(links.note).toBe(locale === 'es' ? '4 puentes en paralelo' : '4 parallel jumpers')
    const strings = parts.find(p => p.id === 'stringFuses')!
    expect(strings.qty).toBe('3')
    expect(strings.spec).toContain(locale === 'es' ? 'clase T, uno por rama' : 'class T, one per parallel string')
    expect(parts.map(p => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'interconnects', 'fuse', 'stringFuses'])
  })

  test('the fuse keeps its class in the spec and states its interrupting rating', () => {
    const fuse = buildParts(result('48-300'), t, locale).find(p => p.id === 'fuse')!
    expect(fuse.spec).toBe(locale === 'es' ? '100 A clase T' : '100 A class T')
    expect(fuse.note).toContain('20 kA')
  })

  test('the batteries note states the bank currents, and the parallel notes only with parallel strings', () => {
    const single = buildParts(result('48-300'), t, locale).find(p => p.id === 'batteries')!
    expect(single.note).toContain(locale === 'es' ? '200 A continuos, 400 A pico' : '200 A continuous, 400 A peak')
    expect(single.note).not.toContain(locale === 'es' ? 'barra colectora' : 'bus bar')
    const parallel = buildParts(result('48-50'), t, locale).find(p => p.id === 'batteries')!
    expect(parallel.note).toContain(locale === 'es' ? 'barra colectora' : 'bus bar')
    expect(parallel.note).toContain('RS485')
  })

  test('the main cable note carries the design current, the derated ampacity and the start-up drop', () => {
    const cable = buildParts(result('48-300'), t, locale).find(p => p.id === 'mainCable')!
    expect(cable.spec).toContain('2 AWG')
    expect(cable.note).toContain('87 A')
    expect(cable.note).toContain('115 A')
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

  test('a one-panel kit says "panel" in the mounting spec', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 5, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const mounting = buildParts(r, t, locale).find((p) => p.id === 'mounting')!
    expect(mounting.spec).toBe(locale === 'es' ? 'Rieles de aluminio y grapas para 1 panel' : 'Aluminium rails and mid/end clamps for 1 panel')
  })

  test('an empty project has no solar rows even with panels chosen', () => {
    const r = compute({ qty: {}, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(buildParts(r, t, locale).some((p) => p.group === 'solar')).toBe(false)
  })
})
