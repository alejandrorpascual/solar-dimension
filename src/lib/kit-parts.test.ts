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
})
