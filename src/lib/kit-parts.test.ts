import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { DEFAULT_HARDWARE } from './catalog'
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

  test('a series-only bank lists one jumper per link, at the gauge and design current of the cable it feeds', () => {
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
      ? 'Un positivo y un negativo de cada rama a las barras colectoras (barras no incluidas) · 29 A de corriente de diseño · 65 A tras la corrección'
      : 'A positive and a negative from each string to the bus bars (bus bars not listed) · 29 A design current · 65 A after derating')
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

  const batteriesNote = (r: ReturnType<typeof compute>) => buildParts(r, t, locale).find(p => p.id === 'batteries')!.note

  test('when the energy sets how many strings are in parallel, the batteries note names no other limit', () => {
    const r = result('12-100')
    expect(r.battery).toMatchObject({ parallel: 2, parallelFor: { energy: 2 } })
    expect(batteriesNote(r)).toBe(locale === 'es'
      ? '4 en serie × 2 en paralelo (4S2P) · banco de 9.6 kWh, 8.2 kWh utilizables · 200 A continuos, 400 A de corriente pico del banco (valores supuestos) · Mismo modelo y edad en cada rama · Cables de igual largo a las barras colectoras · Un fusible en cada rama'
      : '4 in series × 2 in parallel (4S2P) · 9.6 kWh bank, 8.2 kWh usable · 200 A continuous, 400 A peak current from the bank (assumed ratings) · Same model and age in every string · Equal cable lengths to the bus bars · A fuse on each string')
  })

  test('when the energy ties another limit for the strings in parallel, the batteries note names no other limit', () => {
    // 6 h of a microwave on 12 V 100 Ah AGM: the energy and the peak each need 2 strings. The continuous current would
    // need 5, past AGM's 4 in parallel, so the bank keeps the energy's 2.
    const r = compute({ qty: { micro: 1 }, hours: 6, volts: 12, chemistry: 'agm', batteryUnit: '12-100' }, CATALOG_SNAPSHOT)
    expect(r.battery).toMatchObject({ config: '1S2P', parallelFor: { energy: 2, continuous: 5, peak: 2, lead: 1 } })
    expect(batteriesNote(r)).toBe(locale === 'es'
      ? '1 en serie × 2 en paralelo (1S2P) · banco de 2.4 kWh, 1.2 kWh utilizables · 60 A continuos, 200 A de corriente pico del banco (valores supuestos) · Mismo modelo y edad en cada rama · Cables de igual largo a las barras colectoras · Un fusible en cada rama'
      : '1 in series × 2 in parallel (1S2P) · 2.4 kWh bank, 1.2 kWh usable · 60 A continuous, 200 A peak current from the bank (assumed ratings) · Same model and age in every string · Equal cable lengths to the bus bars · A fuse on each string')
  })

  test('an AGM bank its continuous current takes past the energy says so in the batteries note', () => {
    const r = compute({ qty: { fridge: 1, micro: 1 }, hours: 1, volts: 12, chemistry: 'agm' }, CATALOG_SNAPSHOT)
    expect(r.battery).toMatchObject({ config: '1S4P', parallelFor: { energy: 1, continuous: 4, peak: 2, lead: 2 } })
    expect(batteriesNote(r)).toContain(locale === 'es'
      ? '1 en serie × 4 en paralelo (1S4P) · banco de 9.6 kWh, 4.8 kWh utilizables · 4 en paralelo por la corriente continua; la energía sola pide 1 · '
      : '1 in series × 4 in parallel (1S4P) · 9.6 kWh bank, 4.8 kWh usable · 4 in parallel for the continuous current; the energy alone needs 1 · ')
  })

  test('a start-up the units\' peak cannot carry alone sets the strings, and the batteries note names the peak current', () => {
    // A 1 kW inverter that surges to 4 kW: the 3.5 kW start-up needs two 200 A peaks, the running load one unit.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 1000, surge: 4000, volts: [12] as const, surgeSeconds: 5 }] }
    const custom = [{ id: 'x', name: 'Saw', watts: 500, surge: 3500, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 1, volts: 12, chemistry: 'lifepo4', batteryUnit: '12-100' }, CATALOG_SNAPSHOT, hardware)
    expect(r.battery).toMatchObject({ parallel: 2, parallelFor: { energy: 1, continuous: 1, peak: 2, lead: 1 } })
    expect(batteriesNote(r)).toContain(locale === 'es'
      ? '2 en paralelo por la corriente pico; la energía sola pide 1'
      : '2 in parallel for the peak current; the energy alone needs 1')
  })

  test('strings added so no lead carries more than it can are named in the batteries note', () => {
    const r = compute({ qty: { fridge: 1, well: 1, sump: 1 }, hours: 1, volts: 12, chemistry: 'lifepo4', simultaneousStarts: 'all' }, CATALOG_SNAPSHOT)
    expect(r.battery).toMatchObject({ config: '1S3P', parallelFor: { energy: 1, continuous: 2, peak: 2, lead: 3 } })
    expect(batteriesNote(r)).toContain(locale === 'es'
      ? "3 en paralelo para que los cables de ninguna rama lleven más de lo que soportan; la energía sola pide 1"
      : "3 in parallel so no string's leads carry more than they can; the energy alone needs 1")
  })

  test('a one-string bank on a main cable split in two runs prints two jumpers for its one link', () => {
    const custom = [{ id: 'x', name: 'Load', watts: 3000, surge: 3000, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 1, volts: 24, chemistry: 'lifepo4', batteryUnit: '12-200' }, CATALOG_SNAPSHOT)
    const parts = buildParts(r, t, locale)
    expect(parts.find(p => p.id === 'mainCable')).toMatchObject({ qty: '4' })
    const links = parts.find(p => p.id === 'interconnects')!
    expect(links.qty).toBe('2')
    expect(links.spec).toBe(locale === 'es' ? 'Puentes 1/0 AWG, 30 cm cada uno' : '1/0 AWG jumpers, 30 cm each')
    expect(links.note).toBe(locale === 'es'
      ? 'Entre baterías en serie · 2 puentes idénticos lado a lado en cada enlace · 116 A de corriente de diseño cada uno · 150 A tras la corrección'
      : 'Between batteries in series · 2 identical jumpers side by side at every link · 116 A design current each · 150 A after derating')
  })

  test('three in series on two main runs: four jumpers, two at each link, at the same design current the main cable row states', () => {
    const custom = [{ id: 'x', name: 'Load', watts: 4801, surge: 4801, note: '' }]
    const parts = buildParts(compute({ qty: { x: 1 }, custom, hours: 2, volts: 36, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT), t, locale)
    const links = parts.find(p => p.id === 'interconnects')!
    expect(links.qty).toBe('4')
    expect(links.note).toContain(locale === 'es'
      ? '2 puentes idénticos lado a lado en cada enlace · 154 A de corriente de diseño cada uno'
      : '2 identical jumpers side by side at every link · 154 A design current each')
    expect(parts.find(p => p.id === 'mainCable')!.note).toContain(locale === 'es' ? '154 A de corriente de diseño por tramo' : '154 A design current per run')
  })

  test('the main cable note gives the drop at full load and at start-up; runs in parallel to one inverter add equal length and identical lugs', () => {
    const note = (r: ReturnType<typeof compute>) => buildParts(r, t, locale).find(p => p.id === 'mainCable')!.note
    expect(note(result('48-300'))).toBe(locale === 'es'
      ? 'De batería a inversor · 87 A de corriente de diseño · 115 A tras la corrección · 0.2% de caída, 0.1% al arrancar'
      : 'Battery to inverter · 87 A design current · 115 A after derating · 0.2% drop, 0.1% at start-up')
    const load = (watts: number) => ({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Load', watts, surge: watts, note: '' }], hours: 1, chemistry: 'lifepo4' as const })
    expect(note(compute({ ...load(3000), volts: 24, batteryUnit: '12-200' }, CATALOG_SNAPSHOT))).toBe(locale === 'es'
      ? 'De batería a inversor · 116 A de corriente de diseño por tramo · 150 A tras la corrección · 0.4% de caída, 0.3% al arrancar · Mismo largo y terminales idénticos'
      : 'Battery to inverter · 116 A design current per run · 150 A after derating · 0.4% drop, 0.3% at start-up · Equal length, identical lugs')
    // Two inverters on a run each: no conductors in parallel.
    const pair = compute({ ...load(4000), volts: 48 }, CATALOG_SNAPSHOT, { ...DEFAULT_HARDWARE, inverters: [{ w: 3000, surge: 6000, volts: [48], surgeSeconds: 5, maxParallel: 3 }] })
    expect([pair.inverter.count, pair.cable.runs]).toEqual([2, 2])
    expect(note(pair)).not.toContain(locale === 'es' ? 'terminales' : 'lugs')
  })

  test('the fuse keeps its class in the spec and states its interrupting rating', () => {
    const fuse = buildParts(result('48-300'), t, locale).find(p => p.id === 'fuse')!
    expect(fuse.spec).toBe(locale === 'es' ? '100 A clase T' : '100 A class T')
    expect(fuse.note).toContain('20 kA')
  })

  test('the inverter row says "covers" only when the rating has its headroom over the running load', () => {
    // A list whose units work alone, so the largest one is all there is past 9,600 W.
    const hardware = { ...DEFAULT_HARDWARE, inverters: DEFAULT_HARDWARE.inverters.map(({ maxParallel: _maxParallel, ...unit }) => unit) }
    const row = (watts: number, surge = watts) => {
      const custom = [{ id: 'x', name: 'Load', watts, surge, note: '' }]
      return buildParts(compute({ qty: { x: 1 }, custom, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware), t, locale).find(p => p.id === 'inverter')!
    }
    const es = locale === 'es'
    expect(row(9600).note).toBe(es ? '24.0 kW de potencia pico · cubre 9,600 W en marcha y 9,600 W de potencia de arranque' : '24.0 kW surge rating · covers 9,600 W running, 9,600 W start-up power')
    expect(row(9601).note).toBe(es ? '24.0 kW de potencia pico · 9,601 W en marcha dejan 24% de margen, 9,601 W de potencia de arranque' : '24.0 kW surge rating · 9,601 W running leaves 24% headroom, 9,601 W start-up power')
    // An exact fifth of headroom reads as 20%, not 19%.
    expect(row(10000).note).toContain(es ? '10.0 kW en marcha dejan 20% de margen' : '10.0 kW running leaves 20% headroom')
    // A load equal to the rating is carried, with nothing to spare.
    expect(row(12000).note).toBe(es ? '24.0 kW de potencia pico · 12.0 kW en marcha dejan 0% de margen, 12.0 kW de potencia de arranque' : '24.0 kW surge rating · 12.0 kW running leaves 0% headroom, 12.0 kW start-up power')
    // One watt over the rating: exact watts, so a 12.0 kW inverter is not called smaller than a "12.0 kW" load.
    expect(row(12001).note).toBe(es ? '24.0 kW de potencia pico · menor que la carga en marcha de 12,001 W' : '24.0 kW surge rating · smaller than the 12,001 W running load')
    expect(row(15000).note).toBe(es ? '24.0 kW de potencia pico · menor que la carga en marcha de 15,000 W' : '24.0 kW surge rating · smaller than the 15,000 W running load')
    // 2 kW running with a 30 kW start: no single inverter holds that peak, and the row must not say it does.
    expect(row(2000, 30000).note).toBe(es ? '24.0 kW de potencia pico · cubre 2,000 W en marcha, no los 30.0 kW de potencia de arranque' : '24.0 kW surge rating · covers 2,000 W running, not the 30.0 kW start-up power')
    // Short of the headroom and of the peak at once: the row says both and "covers" of neither.
    expect(row(10000, 30000).note).toBe(es ? '24.0 kW de potencia pico · 10.0 kW en marcha dejan 20% de margen, 30.0 kW de potencia de arranque sin cubrir' : '24.0 kW surge rating · 10.0 kW running leaves 20% headroom, 30.0 kW start-up power not covered')
    // Under the running load that is all the row says, whether or not the peak would be held.
    expect(row(15000, 30000).note).toBe(es ? '24.0 kW de potencia pico · menor que la carga en marcha de 15,000 W' : '24.0 kW surge rating · smaller than the 15,000 W running load')
  })

  test('inverters in parallel: the row counts them and says what they give together; the cable and fuse rows are per inverter', () => {
    // One model, so the pick does not depend on how sets are ranked: 7 kW needs 8.75 kW, two 5 kW units.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 5000, surge: 10000, volts: [48] as const, surgeSeconds: 5, maxParallel: 4 }] }
    const kit = (watts: number) => {
      const custom = [{ id: 'x', name: 'Load', watts, surge: watts, note: '' }]
      return buildParts(compute({ qty: { x: 1 }, custom, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware), t, locale)
    }
    const row = (parts: ReturnType<typeof kit>, id: string) => parts.find(p => p.id === id)!
    const es = locale === 'es'
    const [one, two] = [kit(3000), kit(7000)]
    expect(row(one, 'inverter')).toMatchObject({ qty: '1', note: es ? '10.0 kW de potencia pico · cubre 3,000 W en marcha y 3,000 W de potencia de arranque' : '10.0 kW surge rating · covers 3,000 W running, 3,000 W start-up power' })
    // A 7 kW load needs 240 V, so the spec also names the split-phase output.
    expect(row(two, 'inverter')).toMatchObject({
      qty: '2', spec: es ? '5,000 W continuos, no VA, onda pura, entrada 48 V CC, salida de fase partida 120/240 V' : '5,000 W continuous, not VA, pure sine, 48 V DC input, 120/240 V split-phase output',
      note: es
        ? '2 en paralelo trabajan como un inversor de 10.0 kW y toman hasta 231 A de las barras colectoras · 20.0 kW de potencia pico en total · cubre 7,000 W en marcha y 7,000 W de potencia de arranque · Mismo modelo, hechos y enlazados para trabajar en paralelo · Cada uno con sus propios cables con fusible, de igual largo, desde las barras colectoras'
        : '2 in parallel work as one 10.0 kW inverter, drawing up to 231 A from the bus bars · 20.0 kW surge rating together · covers 7,000 W running, 7,000 W start-up power · Same model, built and linked to run in parallel · Each on its own fused cables, of equal length, from the bus bars',
    })
    // Each inverter is wired as the single one is: same gauge and fuse, twice the cables and fuses.
    expect(row(two, 'mainCable')).toMatchObject({ spec: row(one, 'mainCable').spec, qty: '4' })
    expect(row(one, 'mainCable').qty).toBe('2')
    expect(row(two, 'mainCable').note).toContain(es ? '145 A de corriente de diseño por inversor' : '145 A design current per inverter')
    expect(row(one, 'mainCable').note).not.toContain(es ? 'por inversor' : 'per inverter')
    expect(row(two, 'fuse')).toMatchObject({ spec: es ? '150 A clase T por inversor' : '150 A class T per inverter', qty: '2' })
    expect(row(one, 'fuse')).toMatchObject({ spec: es ? '150 A clase T' : '150 A class T', qty: '1' })
    // A set that falls short says so in the row, with the set's figures: stock list, 48 V.
    const stock = (watts: number, surge = watts) =>
      buildParts(compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Load', watts, surge, note: '' }], hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT), t, locale).find(p => p.id === 'inverter')!
    const three = es ? '3 en paralelo trabajan como un inversor de 36.0 kW y toman hasta 833 A de las barras colectoras · 72.0 kW de potencia pico en total' : '3 in parallel work as one 36.0 kW inverter, drawing up to 833 A from the bus bars · 72.0 kW surge rating together'
    expect(stock(28801)).toMatchObject({ qty: '3', spec: es ? '12.0 kW continuos, no VA, onda pura, entrada 48 V CC, salida de fase partida 120/240 V' : '12.0 kW continuous, not VA, pure sine, 48 V DC input, 120/240 V split-phase output' })
    expect(stock(28801).note).toContain(`${three} · ${es ? '28.8 kW en marcha dejan 24% de margen, 28.8 kW de potencia de arranque' : '28.8 kW running leaves 24% headroom, 28.8 kW start-up power'} · `)
    expect(stock(40000).note).toContain(`${three} · ${es ? 'menor que la carga en marcha de 40,000 W' : 'smaller than the 40,000 W running load'} · `)
    expect(stock(5000, 80000).note).toContain(`${three} · ${es ? 'cubre 5,000 W en marcha, no los 80.0 kW de potencia de arranque' : 'covers 5,000 W running, not the 80.0 kW start-up power'} · `)
    // The same pair on a 24 V bank draws twice the current, so each inverter needs two runs.
    const heavy = buildParts(compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Load', watts: 7000, surge: 7000, note: '' }], hours: 2, volts: 24, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, { ...hardware, inverters: [{ ...hardware.inverters[0]!, volts: [24] as const }] }), t, locale)
    expect(row(heavy, 'mainCable')).toMatchObject({ qty: '8' })
    expect(row(heavy, 'mainCable').note).toContain(es ? '145 A de corriente de diseño por tramo, 2 tramos a cada inversor' : '145 A design current per run, 2 runs to each inverter')
    expect(row(heavy, 'fuse')).toMatchObject({ spec: es ? '150 A clase T por tramo, 2 tramos a cada inversor' : '150 A class T per run, 2 runs to each inverter', qty: '4' })
  })

  test('the inverter spec says its size is continuous watts, not VA', () => {
    const spec = buildParts(result('48-300'), t, locale).find(p => p.id === 'inverter')!.spec
    for (const words of locale === 'es' ? ['continuos', 'no VA'] : ['continuous', 'not VA']) expect(spec).toContain(words)
  })

  test('with a 240 V need the inverter spec states the split-phase output it must give; without one it does not', () => {
    const inverterSpec = (qty: Record<string, number>) =>
      buildParts(compute({ qty, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT), t, locale).find(p => p.id === 'inverter')!.spec
    const es = locale === 'es'
    expect(inverterSpec({ ...DEFAULT_QTY, ac2c: 1 })).toBe(es
      ? '4,000 W continuos, no VA, onda pura, entrada 48 V CC, salida de fase partida 120/240 V'
      : '4,000 W continuous, not VA, pure sine, 48 V DC input, 120/240 V split-phase output')
    expect(inverterSpec(DEFAULT_QTY)).toBe(es ? '3,000 W continuos, no VA, onda pura, entrada 48 V CC' : '3,000 W continuous, not VA, pure sine, 48 V DC input')
  })

  test('the batteries note states the bank currents as assumed ratings, and the parallel notes only with parallel strings', () => {
    const single = buildParts(result('48-300'), t, locale).find(p => p.id === 'batteries')!
    expect(single.note).toContain(locale === 'es' ? '200 A continuos, 400 A de corriente pico del banco (valores supuestos)' : '200 A continuous, 400 A peak current from the bank (assumed ratings)')
    expect(single.note).not.toContain(locale === 'es' ? 'barras colectoras' : 'bus bars')
    const parallel = buildParts(result('48-50'), t, locale).find(p => p.id === 'batteries')!
    expect(parallel.note).toContain(locale === 'es' ? 'barras colectoras' : 'bus bars')
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

  test('panels add six tagged rows after the fuse, in order', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 40, panels: 10, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const parts = buildParts(r, t, locale)
    expect(parts.map((p) => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'fuse', 'solarPanels', 'chargeController', 'controllerBattery', 'pvCable', 'pvDisconnect', 'mounting'])
    expect(parts.filter((p) => p.group === 'solar')).toHaveLength(6)
    const panels = parts.find((p) => p.id === 'solarPanels')!
    expect(panels.qty).toBe('10')
    expect(panels.spec).toBe(locale === 'es' ? '550 W monocristalino, 2.28 × 1.13 m' : '550 W monocrystalline, 2.28 × 1.13 m')
    expect(panels.note).toContain(locale === 'es' ? '2 cadenas de 5 en serie' : '2 strings of 5 in series')
    expect(parts.find((p) => p.id === 'chargeController')!.qty).toBe('1')
    expect(parts.find((p) => p.id === 'chargeController')!.spec).toContain('MPPT 100 A')
    expect(parts.find((p) => p.id === 'pvCable')!.qty).toBe('2')
    expect(parts.find((p) => p.id === 'pvDisconnect')!.spec).toContain('40 A')
  })

  test('the controller gets one cable-and-fuse row to the battery: 1.25 × its 100 A is a 125 A fuse, which 1 AWG carries', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 40, panels: 10, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(buildParts(r, t, locale).find((p) => p.id === 'controllerBattery')).toEqual(locale === 'es'
      ? {
        id: 'controllerBattery', group: 'solar', name: 'Controlador a batería: cable y fusible', qty: '1',
        spec: 'Fusible de 125 A clase T · 1 AWG (42.4 mm²) de cobre',
        note: 'Fusible de al menos 1.25 × el controlador de 100 A · el cable soporta 130 A tras la corrección, al aire libre · verifica que entre en los bornes del controlador · conéctalo del lado de la batería con su propio fusible',
      }
      : {
        id: 'controllerBattery', group: 'solar', name: 'Controller to battery: cable and fuse', qty: '1',
        spec: '125 A class T fuse · 1 AWG (42.4 mm²) copper',
        note: "Fuse at least 1.25 × the 100 A controller · cable carries 130 A after derating, in open air · check it fits the controller's terminals · join on the battery side with its own fuse",
      })
  })

  test('zero panels adds no solar rows even with the step turned on', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: 0, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(buildParts(r, t, locale).some((p) => p.group === 'solar')).toBe(false)
  })

  test('a 48 V kit on a roof that holds one panel has no solar rows', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 5, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(buildParts(r, t, locale).some((p) => p.group === 'solar')).toBe(false)
  })

  test('a one-panel kit says "panel" in the mounting spec', () => {
    const r = compute({ qty: DEFAULT_QTY, hours: 10, volts: 24, chemistry: 'lifepo4', solar: { roofM2: 5, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const mounting = buildParts(r, t, locale).find((p) => p.id === 'mounting')!
    expect(mounting.spec).toBe(locale === 'es' ? 'Rieles de aluminio y grapas para 1 panel' : 'Aluminium rails and mid/end clamps for 1 panel')
  })

  test('an empty project has no solar rows even with panels chosen', () => {
    const r = compute({ qty: {}, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(buildParts(r, t, locale).some((p) => p.group === 'solar')).toBe(false)
  })
})

describe('solar rows on every bank voltage and roof', () => {
  const t = getDictionary('en')
  /** Panels in series a string needs to charge each bank: one panel's hot Vmp clears 24 V and falls short of 36 V. */
  const SHORTEST = { 12: 1, 24: 1, 36: 2, 48: 2 } as const

  test('a kit lists the solar rows with equal strings, or none, no yield and a warning that the string is too short', () => {
    const controllerCounts = new Set<number>()
    for (const volts of [12, 24, 36, 48] as const) {
      for (let roofM2 = 5; roofM2 <= 500; roofM2 += 5) {
        for (const panels of [null, 1, 7]) {
          const r = compute({ qty: DEFAULT_QTY, hours: 10, volts, chemistry: 'lifepo4', solar: { roofM2, panels, sunHours: 5 } }, CATALOG_SNAPSHOT)
          const s = r.solar!
          const rows = buildParts(r, t, 'en').filter((p) => p.group === 'solar')
          const tooShort = r.warnings.filter((w) => w.code === 'stringTooShort')
          const at = `${volts} V · ${panels ?? 'recommended'} on ${roofM2} m²`
          if (s.panels > 0) {
            expect(rows.map((p) => p.id), at).toEqual(['solarPanels', 'chargeController', 'controllerBattery', 'pvCable', 'pvDisconnect', 'mounting'])
            // One cable and fuse to the battery for every controller.
            expect(rows[2]!.qty, at).toBe(String(s.controllers))
            controllerCounts.add(s.controllers)
            expect(rows[0]!.qty, at).toBe(String(s.strings * s.perString))
            expect(rows[0]!.note, at).toContain(s.strings === 1 ? `1 string of ${s.perString} in series` : `${s.strings} strings of ${s.perString} in series`)
            expect([tooShort, r.warnings.find((w) => w.code === 'roofLimited')?.params.fit], at).toEqual([[], s.isRoofLimited ? s.wiredFit : undefined])
          } else {
            expect([rows.length, s.dailyWh], at).toEqual([0, 0])
            expect(tooShort, at).toEqual([{ code: 'stringTooShort', params: { volts, count: SHORTEST[volts], fit: s.fit } }])
          }
        }
      }
    }
    expect(Math.max(...controllerCounts)).toBeGreaterThan(1)
  })
})
