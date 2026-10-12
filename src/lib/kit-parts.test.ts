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

  test('a series-only bank lists one link per joint, at the gauge and design current of the cable it feeds', () => {
    const parts = buildParts(result('12-200'), t, locale)
    const part = parts.find(p => p.id === 'interconnects')!
    expect(part.qty).toBe('3')
    expect(part.spec).toBe(locale === 'es' ? 'Puentes 2 AWG, 30 cm cada uno' : '2 AWG jumpers, 30 cm each')
    expect(part.note).toBe(locale === 'es'
      ? 'Entre baterías en serie · 87 A de corriente de diseño · 115 A tras la corrección'
      : 'Between batteries in series · 87 A design current · 115 A after derating')
    expect(parts.map(p => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'interconnects', 'fuse'])
  })

  test('a parallel-only bank has no link row; each string gets a lead pair to the bus bars and a fuse', () => {
    const parts = buildParts(result('48-50'), t, locale)
    const leads = parts.find(p => p.id === 'stringLeads')!
    expect(leads.name).toBe(locale === 'es' ? 'Cables de rama' : 'String leads')
    expect(leads.qty).toBe('6')
    expect(leads.spec).toBe(locale === 'es' ? '6 AWG (13.3 mm²) de cobre, 30 cm cada uno' : '6 AWG (13.3 mm²) copper, 30 cm each')
    expect(leads.note).toBe(locale === 'es'
      ? 'Un positivo y un negativo de cada rama a las barras colectoras · 29 A de corriente de diseño · 65 A tras la corrección'
      : 'A positive and a negative from each string to the bus bars · 29 A design current · 65 A after derating')
    const strings = parts.find(p => p.id === 'stringFuses')!
    expect(strings.qty).toBe('3')
    expect(strings.spec).toContain(locale === 'es' ? 'clase T, uno por rama' : 'class T, one per parallel string')
    expect(parts.map(p => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'stringLeads', 'fuse', 'stringFuses'])
  })

  test('strings in series and in parallel: the links carry one string, so they print at the lead gauge, not the main cable gauge', () => {
    const parts = buildParts(result('12-100'), t, locale)
    expect(parts.find(p => p.id === 'mainCable')!.spec).toContain('2 AWG')
    const links = parts.find(p => p.id === 'interconnects')!
    expect(links.qty).toBe('6')
    expect(links.spec).toContain('6 AWG')
    expect(links.note).toContain(locale === 'es' ? '43 A de corriente de diseño · 65 A tras la corrección' : '43 A design current · 65 A after derating')
    expect(parts.find(p => p.id === 'stringLeads')!.qty).toBe('4')
    expect(parts.map(p => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'interconnects', 'stringLeads', 'fuse', 'stringFuses'])
  })

  test('a one-string bank on a main cable split in two runs prints two jumpers for its one link', () => {
    const custom = [{ id: 'x', name: 'Load', watts: 3000, surge: 3000, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 1, volts: 24, chemistry: 'lifepo4', batteryUnit: '12-200' }, CATALOG_SNAPSHOT)
    const parts = buildParts(r, t, locale)
    expect(parts.find(p => p.id === 'mainCable')).toMatchObject({ qty: '4' })
    const links = parts.find(p => p.id === 'interconnects')!
    expect(links.qty).toBe('2')
    expect(links.spec).toBe(locale === 'es' ? 'Puentes 1 AWG, 30 cm cada uno' : '1 AWG jumpers, 30 cm each')
    expect(links.note).toBe(locale === 'es'
      ? 'Entre baterías en serie, 2 puentes juntos por enlace · 116 A de corriente de diseño cada uno · 130 A tras la corrección'
      : 'Between batteries in series, 2 side by side per link · 116 A design current each · 130 A after derating')
  })

  test('the fuse keeps its class in the spec and states its interrupting rating', () => {
    const fuse = buildParts(result('48-300'), t, locale).find(p => p.id === 'fuse')!
    expect(fuse.spec).toBe(locale === 'es' ? '100 A clase T' : '100 A class T')
    expect(fuse.note).toContain('20 kA')
  })

  test('the inverter row says "covers" only when the rating has its headroom over the running load', () => {
    const row = (watts: number, surge = watts) => {
      const custom = [{ id: 'x', name: 'Load', watts, surge, note: '' }]
      return buildParts(compute({ qty: { x: 1 }, custom, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT), t, locale).find(p => p.id === 'inverter')!
    }
    const es = locale === 'es'
    expect(row(9600).note).toBe(es ? '24.0 kW de arranque · cubre 9,600 W en marcha, 9,600 W pico' : '24.0 kW surge · covers 9,600 W running, 9,600 W peak')
    expect(row(9601).note).toBe(es ? '24.0 kW de arranque · 9,601 W en marcha dejan 24% de margen, 9,601 W pico' : '24.0 kW surge · 9,601 W running leaves 24% headroom, 9,601 W peak')
    // An exact fifth of headroom reads as 20%, not 19%.
    expect(row(10000).note).toContain(es ? '10.0 kW en marcha dejan 20% de margen' : '10.0 kW running leaves 20% headroom')
    // One watt over the rating: exact watts, so the row does not read "12.0 kW under 12.0 kW".
    expect(row(12001).note).toBe(es ? '24.0 kW de arranque · menor que la carga en marcha de 12,001 W' : '24.0 kW surge · smaller than the 12,001 W running load')
    expect(row(15000).note).toBe(es ? '24.0 kW de arranque · menor que la carga en marcha de 15,000 W' : '24.0 kW surge · smaller than the 15,000 W running load')
    // 2 kW running with a 30 kW start: no stock inverter holds that peak, and the row must not say it does.
    expect(row(2000, 30000).note).toBe(es ? '24.0 kW de arranque · cubre 2,000 W en marcha, no el pico de 30.0 kW' : '24.0 kW surge · covers 2,000 W running, not the 30.0 kW peak')
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
