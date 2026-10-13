import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { GAUGES, INVERTERS, SIZING, VOLTAGES, type ChemistryId } from './catalog'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { kitChecks } from './kit-checks'
import { buildParts } from './kit-parts'
import { compute, type CableConditions, type SizingInput, type SizingResult } from './sizing'

const en = getDictionary('en')
const es = getDictionary('es')
const EPS = 1e-9
const TOP_GAUGE = GAUGES[GAUGES.length - 1]!.awg
const CONDUCTOR_ROWS = ['mainCable', 'interconnects', 'stringLeads'] as const
type ConductorRow = (typeof CONDUCTOR_ROWS)[number]

/** One cable row read back from its printed text: the pieces sharing one path, what each carries and what it may carry. */
interface PrintedConductor { row: ConductorRow; gauge: string; sideBySide: number; carriesA: number; ampacity: number }

/**
 * The cable rows as a supplier reads them. Deliberately independent of the engine's helpers: the gauge comes from the
 * spec text, the pieces from the quantity, and the ampacity from the NEC table and the result's stated factors.
 */
function printedConductors(r: SizingResult): PrintedConductor[] {
  const b = r.battery!
  const c = r.cable
  const parts = buildParts(r, en, 'en')
  const stringA = r.inverter.continuousA / b.parallel
  const read = (row: ConductorRow, paths: number, pathA: number, bundleFactor: number): PrintedConductor[] => {
    const part = parts.find((p) => p.id === row)
    if (!part) return []
    const gauge = GAUGES.find((g) => part.spec.startsWith(`${g.awg} `))
    if (!gauge) throw new Error(`${row}: no gauge in "${part.spec}"`)
    const sideBySide = Number(part.qty) / paths
    const table = c.insulationC === 75 ? gauge.amps75 : gauge.amps90
    return [{ row, gauge: gauge.awg, sideBySide, carriesA: pathA / sideBySide, ampacity: Math.min(table * c.ambientFactor * bundleFactor, gauge.amps75) }]
  }
  return [
    // A positive and a negative path to the inverter; the runs on each share the bank's current.
    ...read('mainCable', 2, r.inverter.continuousA, c.bundleFactor),
    // One place between each pair of neighbours in a string; whatever is fitted there carries that string's current.
    ...read('interconnects', (b.series - 1) * b.parallel, stringA, 1),
    // A positive and a negative for each string, in open air like the links.
    ...read('stringLeads', 2 * b.parallel, stringA, 1),
  ]
}

const isShort = (x: PrintedConductor) => x.ampacity + EPS < SIZING.NEC_CONTINUOUS * x.carriesA
const show = (x: PrintedConductor) =>
  `${x.row} ${x.sideBySide} × ${x.gauge}: ${x.ampacity.toFixed(1)} A for ${(SIZING.NEC_CONTINUOUS * x.carriesA).toFixed(1)} A`

const load = (watts: number) => ({ custom: [{ id: 'x', name: 'Load', watts, surge: watts, note: '' }], qty: { x: 1 } })
const COOL_OPEN_AIR: Partial<CableConditions> = {}
const INSTALLATIONS: readonly Partial<CableConditions>[] = [COOL_OPEN_AIR, { ambientC: 50, insulationC: 75 }, { ambientC: 40, bundled: true }]
const CHEMISTRY_IDS: readonly ChemistryId[] = ['lifepo4', 'agm']
const WINDOWS_H = [1, 2, 4, 8, 12, 24]
/**
 * Past one inverter: the largest load each stock set is picked for (2 × 8, 2 × 10, 2 × 12, 3 × 10 and 3 × 12 kW), and
 * two lighter ones (10 and 16.5 kW) whose banks need the fewest strings for their energy.
 */
const SET_LOADS_W = [10000, 12800, 16000, 16500, 19200, 24000, 28800]

interface Kit { label: string; cable: Partial<CableConditions>; r: SizingResult; printed: PrintedConductor[] }

const layoutOf = (k: Kit) => `${k.r.battery!.series > 1 ? 'S' : ''}${k.r.battery!.parallel > 1 ? 'P' : ''}`
/** The layout the defect lived in: batteries in series on one string, behind a main cable split into runs. */
const isOneStringOnSeveralRuns = (k: Kit) => layoutOf(k) === 'S' && k.r.cable.runs > 1
const flaggedRows = (k: Kit) => new Set(k.r.warnings.filter((w) => w.code === 'cableUndersized').map((w) => w.params.conductor))
/** A short row is acceptable only when nothing bigger could be printed: the largest gauge, and for the main cable every run it may have, MAX_RUNS to each inverter. */
const hasNothingBigger = (k: Kit, x: PrintedConductor) =>
  x.gauge === TOP_GAUGE && (x.row !== 'mainCable' || k.r.cable.runs === SIZING.MAX_RUNS * k.r.inverter.count)
const designCurrent = (note: string | undefined) => /([\d,]+) A design current/.exec(note ?? '')?.[1]

/**
 * Each stock inverter's largest load at every bank voltage, both chemistries, six windows and three installations, on
 * the automatic bank and on every unit the picker offers. A load too small for a voltage gets that voltage's smallest
 * inverter; one too big falls back to an inverter not built for it, with currents far past what one cable carries.
 */
function stockKits(): Kit[] {
  const loads = [...INVERTERS.map((inv) => Math.floor(inv.w / SIZING.HEADROOM)), ...SET_LOADS_W]
  const bases = VOLTAGES.flatMap((volts) => loads.flatMap((watts) =>
    CHEMISTRY_IDS.flatMap((chemistry) => WINDOWS_H.flatMap((hours) => INSTALLATIONS.map((cable): SizingInput =>
      ({ ...load(watts), hours, volts, chemistry, cable })))),
  ))
  return bases.flatMap((input) => {
    const units = [null, ...compute(input, CATALOG_SNAPSHOT).batteryOptions.map((o) => o.id)]
    return units.map((batteryUnit) => {
      const r = compute({ ...input, batteryUnit }, CATALOG_SNAPSHOT)
      const where = `${input.cable?.ambientC ?? 30} °C${input.cable?.bundled ? ' bundled' : ''}`
      const label = `${input.volts} V ${r.inverter.w} W ${input.chemistry} ${input.hours} h ${batteryUnit ?? 'auto'} ${r.battery!.config}, ${r.cable.runs} runs, ${where}`
      return { label, cable: input.cable ?? {}, r, printed: printedConductors(r) }
    })
  })
}

describe('printed conductors', () => {
  const kits = stockKits()

  test('the sweep covers every inverter the engine can pick at each voltage, on single, series, parallel and series-parallel banks', () => {
    // A load under the smallest inverter built for a voltage still gets that one, so the pairs start there.
    const pairs = VOLTAGES.flatMap((v) => {
      const smallest = Math.min(...INVERTERS.filter((i) => i.volts.includes(v)).map((i) => i.w))
      return INVERTERS.filter((i) => i.w >= smallest).map((i) => `${v}:${i.w}`)
    })
    const alone = kits.filter((k) => k.r.inverter.count === 1)
    expect(new Set(alone.map((k) => `${k.r.volts}:${k.r.inverter.w}`))).toEqual(new Set(pairs))
    // Past one inverter the same sets are listed at every bank voltage, each built from 48 V units.
    const sets = kits.filter((k) => k.r.inverter.count > 1)
    expect(sets.length).toBeGreaterThan(4000)
    expect(new Set(sets.map((k) => `${k.r.inverter.count} × ${k.r.inverter.unitW}`))).toEqual(new Set(['2 × 8000', '2 × 10000', '2 × 12000', '3 × 10000', '3 × 12000']))
    expect(kits.some((k) => !k.r.inverter.voltsOk)).toBe(true)
    // Floors a quarter or less of today's counts (480, 660, 2,718 and 4,422; 139 on several runs), so retiring a battery unit does not fail this.
    const count = (is: (k: Kit) => boolean) => kits.filter(is).length
    expect(count((k) => layoutOf(k) === '')).toBeGreaterThan(100)
    expect(count((k) => layoutOf(k) === 'S')).toBeGreaterThan(150)
    expect(count((k) => layoutOf(k) === 'P')).toBeGreaterThan(500)
    expect(count((k) => layoutOf(k) === 'SP')).toBeGreaterThan(1000)
    expect(count(isOneStringOnSeveralRuns)).toBeGreaterThan(30)
  })

  test('every cable row carries 125% of its continuous current; one that cannot is the largest there is, and the cable check names it', () => {
    const unflagged = kits.flatMap((k) => {
      const flagged = flaggedRows(k)
      const cable = kitChecks(en, k.r, 'en').find((c) => c.id === 'cable')!
      const isExcused = (x: PrintedConductor) => cable.status === 'warn' && flagged.has(x.row) && hasNothingBigger(k, x)
      return k.printed.filter(isShort).filter((x) => !isExcused(x)).map((x) => `${k.label} | ${show(x)}`)
    })
    expect(unflagged).toEqual([])
  })

  test('the cable check names a row only when that row is short', () => {
    const falseAlarms = kits.flatMap((k) => {
      const short = new Set(k.printed.filter(isShort).map((x) => x.row))
      return [...flaggedRows(k)].filter((row) => !row || !short.has(row)).map((row) => `${k.label} | ${row} named, not short`)
    })
    expect(falseAlarms).toEqual([])
  })

  test('in a cool room with open-air cable, no kit whose inverter is built for its bank voltage prints a short conductor at all, unless the bank is marked short on its leads', () => {
    // A bank takes the strings its leads need. A battery picked by hand may not allow them (its maker's parallel limit, or a
    // fault its fuses could not interrupt): the bank then says so, and the cable check names the lead (the tests above).
    const sound = kits.filter((k) => k.cable === COOL_OPEN_AIR && k.r.inverter.voltsOk && k.r.battery!.leadOk)
    expect(sound.length).toBeGreaterThan(1500)
    expect(sound.filter((k) => k.r.inverter.count > 1).length).toBeGreaterThan(500)
    // 11 today.
    expect(sound.filter(isOneStringOnSeveralRuns).length).toBeGreaterThan(4)
    expect(sound.flatMap((k) => k.printed.filter(isShort).map((x) => `${k.label} | ${show(x)}`))).toEqual([])
    // Whenever some battery size allows them, the automatic bank is one that does.
    const automatic = kits.filter((k) => k.cable === COOL_OPEN_AIR && k.r.inverter.voltsOk && k.r.batteryUnit === null)
    const avoidable = automatic.filter((k) => !k.r.battery!.leadOk && k.r.batteryOptions.some((o) => o.dischargeOk && o.peakOk && !o.overMaxParallel && o.leadOk))
    expect(avoidable.map((k) => k.label)).toEqual([])
  })

  test('every inverter of a kit gets the same whole number of runs, with a fuse on each run and a cable pair for it', () => {
    const wrong = kits.flatMap((k) => {
      const { runs } = k.r.cable
      const parts = buildParts(k.r, en, 'en')
      const qty = (id: string) => Number(parts.find((p) => p.id === id)!.qty)
      const inStep = Number.isInteger(runs / k.r.inverter.count) && runs >= k.r.inverter.count
      return inStep && qty('inverter') === k.r.inverter.count && qty('fuse') === runs && qty('mainCable') === 2 * runs ? [] : [k.label]
    })
    expect(wrong).toEqual([])
    // Two and three inverters, at their own voltage and at another's, are all in the sweep.
    expect(new Set(kits.map((k) => `${k.r.inverter.count}${k.r.inverter.voltsOk ? '' : ' off-voltage'}`))).toEqual(new Set(['1', '1 off-voltage', '2', '2 off-voltage', '3', '3 off-voltage']))
  })

  test('a link that copies the main cable prints the design current of the main run it copies', () => {
    const differ = kits.filter((k) => layoutOf(k) === 'S').flatMap((k) => {
      const parts = buildParts(k.r, en, 'en')
      const main = designCurrent(parts.find((p) => p.id === 'mainCable')?.note)
      const link = designCurrent(parts.find((p) => p.id === 'interconnects')?.note)
      return main && main === link ? [] : [`${k.label} | main ${main} A, link ${link} A`]
    })
    expect(differ).toEqual([])
  })

  test('each main run and each string has a fuse of its own, and no string fuse is rated above its lead unless the fuse check says so', () => {
    const wrong = kits.flatMap((k) => {
      const parts = buildParts(k.r, en, 'en')
      const parallel = k.r.battery!.parallel
      const qty = (id: string) => parts.find((p) => p.id === id)?.qty ?? null
      const lead = k.printed.find((x) => x.row === 'stringLeads')
      const stringFuseA = Number.parseInt(parts.find((p) => p.id === 'stringFuses')?.spec ?? '', 10)
      const isWarned = k.r.warnings.some((w) => w.code === 'fuseAboveCable')
      const problems = [
        qty('fuse') !== String(k.r.cable.runs) ? `${qty('fuse')} main fuses` : '',
        qty('stringFuses') !== (parallel > 1 ? String(parallel) : null) ? `${qty('stringFuses')} string fuses` : '',
        lead && stringFuseA > lead.ampacity + EPS && !isWarned ? `${stringFuseA} A fuse on a ${lead.ampacity.toFixed(1)} A lead` : '',
      ].filter(Boolean)
      return problems.map((p) => `${k.label} | ${p}`)
    })
    expect(wrong).toEqual([])
  })

  test('a bank gets a link row only with batteries in series and a lead row only with strings in parallel, in whole pieces', () => {
    const wrong = kits.flatMap((k) => {
      const b = k.r.battery!
      const by = Object.fromEntries(k.printed.map((x) => [x.row, x]))
      const problems = [
        (b.series > 1) !== ('interconnects' in by) ? 'link row' : '',
        (b.parallel > 1) !== ('stringLeads' in by) ? 'lead row' : '',
        by.stringLeads && by.stringLeads.sideBySide !== 1 ? `${by.stringLeads.sideBySide} leads per string end` : '',
        ...k.printed.filter((x) => !Number.isInteger(x.sideBySide) || x.sideBySide < 1).map((x) => `${x.row} in ${x.sideBySide} pieces per path`),
      ].filter(Boolean)
      return problems.map((p) => `${k.label} | ${p}`)
    })
    expect(wrong).toEqual([])
  })

  test('the 24 V 2S1P kit on two main runs prints links that cover its 231 A design current', () => {
    const r = compute({ ...load(3000), hours: 1, volts: 24, chemistry: 'lifepo4', batteryUnit: '12-200' }, CATALOG_SNAPSHOT)
    expect(r.battery!.config).toBe('2S1P')
    expect(r.cable.runs).toBe(2)
    const designA = r.inverter.continuousA * SIZING.NEC_CONTINUOUS
    expect(designA).toBeCloseTo(231.5, 1)
    const link = printedConductors(r).find((x) => x.row === 'interconnects')!
    expect(link).toMatchObject({ gauge: '1 AWG', sideBySide: 2, ampacity: 130 })
    expect(link.sideBySide * link.ampacity).toBeGreaterThanOrEqual(designA)
    expect(kitChecks(en, r, 'en').find((c) => c.id === 'cable')!.status).toBe('pass')
  })

  test('a string lead too hot for any single cable turns the cable check to a warning that names the row', () => {
    // 6 kW at 12 V draws 556 A and the maker allows four strings: three carry 185 A each and need 231.5 A of cable;
    // 4/0 carries 172.5 A in 50 °C air on 75 °C insulation.
    const r = compute({ ...load(4800), hours: 1, volts: 12, chemistry: 'lifepo4', cable: { ambientC: 50, insulationC: 75 } }, CATALOG_SNAPSHOT)
    expect([r.battery!.parallel, r.battery!.unit.maxParallel]).toEqual([3, 4])
    expect(printedConductors(r).filter(isShort).map((x) => x.row)).toEqual(['stringLeads'])
    expect(kitChecks(en, r, 'en').find((c) => c.id === 'cable')!.status).toBe('warn')
    expect(r.warnings.filter((w) => w.code === 'cableUndersized').map((w) => w.params)).toMatchObject([{ conductor: 'stringLeads', gauge: '4/0 AWG', maxA: 172.5, needA: 231.5 }])
  })
})

/** Kits an audit found printing bank wiring under its current: catalog appliances, on the bank the app picks by itself unless a unit is named. */
describe('kits the audit found with bank wiring under its current', () => {
  const kit = (input: Partial<SizingInput> & Pick<SizingInput, 'qty' | 'hours' | 'volts'>) => compute({ chemistry: 'lifepo4', ...input }, CATALOG_SNAPSHOT)
  const cableCheck = (r: SizingResult) => kitChecks(en, r, 'en').find((c) => c.id === 'cable')!
  const row = (r: SizingResult, id: ConductorRow) => printedConductors(r).find((x) => x.row === id)!

  test('24 V, a 2 ton inverter AC, fridge and lights for 3 h: the one series link is two 1 AWG jumpers', () => {
    const r = kit({ qty: { ac2i: 1, fridge: 1, lights: 1 }, hours: 3, volts: 24 })
    expect([r.inverter.w, r.battery!.config, r.batteryUnit, r.cable.runs, r.cable.gauge]).toEqual([4000, '2S1P', null, 2, '1 AWG'])
    expect(row(r, 'interconnects')).toMatchObject({ gauge: '1 AWG', sideBySide: 2, ampacity: 130 })
    expect(printedConductors(r).filter(isShort)).toEqual([])
    expect(cableCheck(r).status).toBe('pass')
  })

  test('36 V in a hot room on 75 °C cable: each of the two links gets a jumper per main run', () => {
    const r = kit({ qty: { kettle: 1 }, hours: 12, volts: 36, cable: { runLengthM: 10, ambientC: 50, insulationC: 75 } })
    expect([r.battery!.series, r.battery!.parallel, r.batteryUnit, r.cable.runs]).toEqual([3, 1, null, 2])
    expect(row(r, 'interconnects')).toMatchObject({ gauge: r.cable.gauge, sideBySide: 2 })
    // Four jumpers to buy, two at each link: the note states the per-link figure, not the total.
    const links = (t: typeof en, locale: 'en' | 'es') => buildParts(r, t, locale).find((p) => p.id === 'interconnects')!
    expect(links(en, 'en').qty).toBe('4')
    expect(links(en, 'en').note).toContain('2 identical jumpers side by side at every link')
    expect(links(es, 'es').note).toContain('2 puentes idénticos lado a lado en cada enlace')
    expect(printedConductors(r).filter(isShort)).toEqual([])
  })

  test('12 V AGM, twelve sliding-gate motors on 6 V batteries: the one link gets a jumper for each of the six main runs', () => {
    const r = kit({ qty: { 'gate-slide': 12 }, hours: 1, volts: 12, chemistry: 'agm', batteryUnit: '6-225' })
    expect([r.battery!.config, r.batteryUnit, r.cable.runs]).toEqual(['2S1P', '6-225', 6])
    expect(row(r, 'interconnects')).toMatchObject({ gauge: r.cable.gauge, sideBySide: 6 })
    expect(printedConductors(r).filter(isShort)).toEqual([])
    expect(r.warnings.map((w) => w.code)).not.toContain('cableUndersized')
  })

  test('12 V heater and microwave: the string lead the engine sized is a row of its own, and a third string keeps it within one cable', () => {
    // 2.7 kW plus the 25% headroom is past the largest 12 V inverter (3 kW), so the engine falls back to a 4 kW one: 370 A.
    // Two strings would carry 185 A each, more than a 4/0 lead and its fuse back, so the bank takes three at 123 A.
    const r = kit({ qty: { heater: 1, micro: 1 }, hours: 4, volts: 12 })
    expect([r.inverter.w, r.inverter.voltsOk, r.battery!.config, r.cable.gauge, r.cable.string!.gauge]).toEqual([4000, false, '1S3P', '2/0 AWG', '2/0 AWG'])
    const leads = buildParts(r, en, 'en').find((p) => p.id === 'stringLeads')!
    expect(leads.spec).toBe('2/0 AWG (67.4 mm²) copper, 30 cm each')
    expect(leads.qty).toBe('6')
    expect(printedConductors(r).filter(isShort)).toEqual([])
    // The check still fails, for the 370 A a 12 V bank is asked for, not for a conductor.
    expect(cableCheck(r).status).toBe('warn')
    expect(cableCheck(r).lines).toEqual(['370 A on the DC side at 12 V is hard to wire safely. Consider 24 V.'])
  })
})
