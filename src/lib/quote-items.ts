import { CHEMISTRIES, GAUGES, SIZING, type ChemistryId, type FuseClass } from './catalog'
import { lineSize, MM2_TOLERANCE, tableGauge, type CableSize } from './quote-gauge'
import type { LineKind, QuoteExtraction, QuoteLine } from './quote-schema'
import type { SizingResult } from './sizing'
import { correctedAmpacity } from './sizing/cable'

export const ITEM_IDS = ['inverter', 'battery', 'charger', 'wifi', 'cables', 'fuse', 'installation', 'warranty'] as const
export type ItemId = (typeof ITEM_IDS)[number]
/** The five items shown as icons in a quote's row. */
export const STRIP_ITEMS: readonly ItemId[] = ['charger', 'wifi', 'cables', 'fuse', 'installation']

/**
 * ok = meets the kit · short = there but too small · missing = excluded or only optional · unknown = not mentioned, or
 * mentioned without enough to judge it (a size, a class, a count or a chemistry left open)
 */
export type ItemStatus = 'ok' | 'short' | 'missing' | 'unknown'
export const OVERRIDES = ['included', 'not_included'] as const
export type Override = (typeof OVERRIDES)[number]
export type Overrides = Partial<Record<ItemId, Override>>
export type Musts = Record<ItemId, boolean>

export const DEFAULT_MUSTS: Musts = {
  inverter: true, battery: true, charger: true, wifi: false, cables: true, fuse: true, installation: true, warranty: false,
}

export function resolveMusts(stored: Partial<Musts> | null | undefined): Musts {
  return { ...DEFAULT_MUSTS, ...(stored ?? {}) }
}

/** A new overrides object with `item` set to `value`, or removed when `value` is null. */
export function setOverride(o: Overrides, item: ItemId, value: Override | null): Overrides {
  const rest = Object.fromEntries(Object.entries(o).filter(([k]) => k !== item)) as Overrides
  return value === null ? rest : { ...rest, [item]: value }
}

/** What the kit asks of a quote. `usableWh` is the energy the bank must deliver: the load over inverter losses. */
export interface KitNeeds {
  runningW: number; surgeW: number; usableWh: number; chemistry: ChemistryId
  cableMm2: number; cableGauge: string; fuseA: number
  /** The main cable's runs, and the design current they carry together (continuous × the NEC factor). */
  cableRuns: number; designA: number
  /** What one run of each table gauge may carry at this kit's site, by the engine's own correction: keyed by `Gauge.awg`. */
  ampacityByGauge: Readonly<Record<string, number>>
  /** How many main fuses the kit lists, each of `fuseA`, and their class. */
  fuseCount: number; fuseClass: FuseClass
}

/** The heaviest battery-side cable the parts list prints: a string lead can be thicker than one run of a split main cable. */
function thickestCable(c: SizingResult['cable']): { mm2: number; gauge: string } {
  return [c.string, c.links].reduce<{ mm2: number; gauge: string }>((top, row) => (row && row.mm2 > top.mm2 ? row : top), c)
}

export function kitNeeds(r: SizingResult): KitNeeds {
  const cable = thickestCable(r.cable)
  return {
    runningW: r.runningW, surgeW: r.surgeW, usableWh: r.loadWh / SIZING.INVERTER_EFF, chemistry: r.chemistry,
    cableMm2: cable.mm2, cableGauge: cable.gauge, fuseA: r.cable.fuseA,
    cableRuns: r.cable.runs, designA: r.cable.designA,
    ampacityByGauge: Object.fromEntries(GAUGES.map((g) => [g.awg, correctedAmpacity(g, r.cable, r.cable.conductors)])),
    fuseCount: r.fuse.count, fuseClass: r.fuse.class,
  }
}

/** What an item check found, as numbers; quote-text.ts turns them into words. */
export interface ItemFacts {
  watts?: number; surgeWatts?: number; surgeUnknown?: boolean; shortW?: number; shortSurgeW?: number
  usableWh?: number; shortWh?: number
  /** The bank before depth of discharge, and the depth applied when every line shares one; `dodAssumed` when no line names its chemistry. */
  nominalWh?: number; dod?: number; dodAssumed?: boolean
  /** Usable energy at the lowest and the highest depth of discharge, when the verdict depends on a chemistry the quote doesn't name. */
  usableLowWh?: number; usableHighWh?: number
  /** A battery line states no capacity, and the lines that do don't reach the kit on their own. */
  capacityPartial?: boolean
  builtIn?: boolean; amps?: number
  gauge?: string; sizeUnknown?: boolean
  /** Runs of the quoted cable the current needs, when more than one, and whether the quote's quantity leaves them open. */
  runs?: number; runsUnstated?: boolean
  /** A fuse rated above what its cable carries (`maxA`, one run at this site). */
  maxA?: number
  /** The fuse class the quote states, when it isn't the kit's. */
  fuseClass?: string
  /** How many main fuses the quote lists, when together they carry less than the kit's. */
  fuses?: number
  optionalPrice?: number
  batteryYears?: number; inverterYears?: number
  confirmed?: boolean
}
export interface ItemCheck { id: ItemId; status: ItemStatus; facts: ItemFacts; source: QuoteLine['source'] | null }

/** A DC run is a positive and a negative lead: what a wiring line's quantity is counted in. */
const LEADS_PER_RUN = 2
/** NEC 310.10(G): only conductors of 1/0 and larger may run in parallel, so only they can share one fuse. */
const PARALLEL_MIN_AWG = '1/0 AWG'
const PARALLEL_MIN_MM2 = GAUGES.find((g) => g.awg === PARALLEL_MIN_AWG)!.mm2

const check = (id: ItemId, status: ItemStatus, facts: ItemFacts = {}, source: QuoteLine['source'] | null = null): ItemCheck =>
  ({ id, status, facts, source })
const ofKind = (x: QuoteExtraction, kind: LineKind, optional: boolean): QuoteLine[] =>
  x.lines.filter((l) => l.kind === kind && l.optional === optional)
const sum = (ls: readonly QuoteLine[], f: (l: QuoteLine) => number): number => ls.reduce((a, l) => a + f(l), 0)
const sourceOf = (ls: readonly QuoteLine[]): QuoteLine['source'] | null => ls[0]?.source ?? null
/** The lowest price among the lines that have one: a bundled extra split into lines leaves its parts at 0. */
const cheapestPriced = (ls: readonly QuoteLine[]): number | undefined => {
  const prices = ls.map((l) => l.lineTotal).filter((p) => p > 0)
  return prices.length > 0 ? Math.min(...prices) : undefined
}

/** No included line of `kind`: missing when the quote offers it only as an optional extra, otherwise unknown. */
function absent(id: ItemId, x: QuoteExtraction, kind: LineKind): ItemCheck {
  const extras = ofKind(x, kind, true)
  return extras.length ? check(id, 'missing', { optionalPrice: cheapestPriced(extras) }, sourceOf(extras)) : check(id, 'unknown')
}

function checkInverter(x: QuoteExtraction, kit: KitNeeds): ItemCheck {
  const lines = ofKind(x, 'inverter', false)
  const sized = lines.filter((l) => l.specs.watts !== null)
  if (sized.length === 0) return check('inverter', 'unknown', {}, sourceOf(lines))
  const watts = sum(sized, (l) => (l.specs.watts ?? 0) * l.qty)
  const surgeKnown = sized.every((l) => l.specs.surgeWatts !== null)
  const surgeWatts = surgeKnown ? sum(sized, (l) => (l.specs.surgeWatts ?? 0) * l.qty) : null
  const shortW = Math.max(0, kit.runningW - watts)
  const shortSurgeW = surgeWatts === null ? 0 : Math.max(0, kit.surgeW - surgeWatts)
  const facts: ItemFacts = {
    watts,
    ...(surgeWatts === null ? { surgeUnknown: true } : { surgeWatts }),
    ...(shortW > 0 ? { shortW } : {}),
    ...(shortSurgeW > 0 ? { shortSurgeW } : {}),
  }
  return check('inverter', inverterStatus(shortW, shortSurgeW, surgeWatts === null && watts < kit.surgeW), facts, sourceOf(sized))
}

/**
 * Short when a stated rating falls below the kit. With no surge stated, the running rating alone covers the start-up
 * surge only when it reaches it; below that, whether the inverter starts the kit is unknown, not ok.
 */
function inverterStatus(shortW: number, shortSurgeW: number, isSurgeUnclear: boolean): ItemStatus {
  if (shortW > 0 || shortSurgeW > 0) return 'short'
  return isSurgeUnclear ? 'unknown' : 'ok'
}

const lineWh = (l: QuoteLine): number | null => {
  if (l.specs.kWh !== null) return l.specs.kWh * 1000
  return l.specs.batteryVolts !== null && l.specs.ah !== null ? l.specs.batteryVolts * l.specs.ah : null
}
const BY_DOD = Object.values(CHEMISTRIES).sort((a, b) => a.dod - b.dod)
/** The chemistries a bank that names none is judged between: the lowest depth of discharge and the highest. */
export const LOWEST_DOD_CHEMISTRY: ChemistryId = BY_DOD[0]!.id
export const HIGHEST_DOD_CHEMISTRY: ChemistryId = BY_DOD[BY_DOD.length - 1]!.id
const LOWEST_DOD = CHEMISTRIES[LOWEST_DOD_CHEMISTRY].dod
const HIGHEST_DOD = CHEMISTRIES[HIGHEST_DOD_CHEMISTRY].dod

/**
 * The depth of discharge a line's chemistry gives. A line that names no chemistry the catalog has ("other" covers gel
 * and flooded lead-acid as much as lithium) could be any of them: the range from the lowest to the highest.
 */
function dodRange(l: QuoteLine): { low: number; high: number } {
  const c = l.specs.chemistry
  if (c === 'lifepo4' || c === 'agm') return { low: CHEMISTRIES[c].dod, high: CHEMISTRIES[c].dod }
  return { low: LOWEST_DOD, high: HIGHEST_DOD }
}

/**
 * Usable energy from what the lines state, never from the project's chemistry: a bank passes when it passes whatever its
 * unnamed chemistry is, falls short when it falls short at the best one, and otherwise depends on the chemistry. A line
 * with no capacity could make up a shortfall, so it leaves a short bank unknown.
 */
function checkBattery(x: QuoteExtraction, kit: KitNeeds): ItemCheck {
  const lines = ofKind(x, 'battery', false)
  const sized = lines.flatMap((l) => {
    const wh = lineWh(l)
    return wh === null ? [] : [{ l, wh: wh * l.qty, ...dodRange(l) }]
  })
  if (sized.length === 0) return check('battery', 'unknown', {}, sourceOf(lines))
  const source = sourceOf(sized.map((s) => s.l))
  const nominalWh = sized.reduce((a, s) => a + s.wh, 0)
  const lowWh = sized.reduce((a, s) => a + s.wh * s.low, 0)
  const highWh = sized.reduce((a, s) => a + s.wh * s.high, 0)
  const dodAssumed = sized.every((s) => s.low !== s.high)
  // The depth applied, printed beside the sum when one covers every line: the stated one, or the bound the verdict rests on.
  const applied = (bound: 'low' | 'high'): ItemFacts => {
    const ds = new Set(sized.map((s) => s[bound]))
    return ds.size === 1 ? { dod: [...ds][0]!, ...(dodAssumed ? { dodAssumed } : {}) } : {}
  }
  if (lowWh >= kit.usableWh) return check('battery', 'ok', { usableWh: lowWh, nominalWh, ...applied('low') }, source)
  const capacityPartial = sized.length < lines.length
  if (highWh < kit.usableWh && !capacityPartial) {
    return check('battery', 'short', { usableWh: highWh, shortWh: kit.usableWh - highWh, nominalWh, ...applied('high') }, source)
  }
  return check('battery', 'unknown', { usableLowWh: lowWh, usableHighWh: highWh, nominalWh, ...(capacityPartial ? { capacityPartial } : {}) }, source)
}

interface Feature { id: 'charger' | 'wifi'; kind: LineKind; flag: 'hasCharger' | 'hasWifi' }

function checkFeature(x: QuoteExtraction, { id, kind, flag }: Feature): ItemCheck {
  const ampsOf = (ls: readonly QuoteLine[]): ItemFacts => {
    const amps = id === 'charger' ? ls.find((l) => l.specs.chargerAmps !== null)?.specs.chargerAmps ?? null : null
    return amps === null ? {} : { amps }
  }
  const lines = ofKind(x, kind, false)
  if (lines.length) return check(id, 'ok', ampsOf(lines), sourceOf(lines))
  const inverters = ofKind(x, 'inverter', false)
  const builtIn = inverters.filter((l) => l.specs[flag] === true)
  if (builtIn.length) return check(id, 'ok', { builtIn: true, ...ampsOf(builtIn) }, sourceOf(builtIn))
  const optional = absent(id, x, kind)
  if (optional.status === 'missing') return optional
  const denied = inverters.filter((l) => l.specs[flag] === false)
  return denied.length ? check(id, 'missing', {}, sourceOf(denied)) : optional
}

/** The thickest wiring line whose size can be read, with that size. */
function thickest(lines: readonly QuoteLine[]): { line: QuoteLine; size: CableSize } | null {
  return lines.reduce<{ line: QuoteLine; size: CableSize } | null>((top, line) => {
    const size = lineSize(line.specs)
    return size !== null && (top === null || size.mm2 > top.size.mm2) ? { line, size } : top
  }, null)
}

/** What one run of a quoted size carries at the kit's site, from the table gauge it matches; null below the table. */
function runAmpacity(mm2: number, kit: KitNeeds): number | null {
  const g = tableGauge(mm2)
  return g === null ? null : kit.ampacityByGauge[g.awg] ?? null
}

/** Runs of a cable that carries `ampacity` that `amps` needs: one when one run carries it all. */
const runsFor = (amps: number, ampacity: number): number => Math.max(1, Math.ceil(amps / ampacity))

/** Whether the wiring lines of at least this size add up to the leads of `runs` runs. One run needs no count. */
function hasLeads(lines: readonly QuoteLine[], mm2: number, runs: number): boolean {
  if (runs <= 1) return true
  const leads = sum(lines.filter((l) => (lineSize(l.specs)?.mm2 ?? 0) >= mm2 * MM2_TOLERANCE), (l) => l.qty)
  return leads >= runs * LEADS_PER_RUN
}

/**
 * Thinner than the kit's is short, and no readable size leaves it to confirm. A size that the kit's current needs more
 * than one run of passes only when the quote's quantity reaches their leads: a wiring line's quantity may be pieces,
 * metres or one lot, so a count never fails a quote, it leaves it to confirm.
 */
function checkCables(x: QuoteExtraction, kit: KitNeeds): ItemCheck {
  const lines = ofKind(x, 'wiring', false)
  if (lines.length === 0) return absent('cables', x, 'wiring')
  const top = thickest(lines)
  if (top === null) return check('cables', 'unknown', { sizeUnknown: true }, sourceOf(lines))
  const gauge = top.size.label
  if (top.size.mm2 < kit.cableMm2 * MM2_TOLERANCE) return check('cables', 'short', { gauge }, top.line.source)
  const ampacity = runAmpacity(top.size.mm2, kit)
  const runs = ampacity === null ? 1 : runsFor(kit.designA, ampacity)
  if (runs === 1) return check('cables', 'ok', { gauge }, top.line.source)
  const isCounted = hasLeads(lines, top.size.mm2, runs)
  return check('cables', isCounted ? 'ok' : 'unknown', { gauge, runs, ...(isCounted ? {} : { runsUnstated: true }) }, top.line.source)
}

/** The class letters a quote writes ("T", "Clase T", "class-T"), upper-cased, without the word for class. */
function fuseClassOf(written: string | null): string | null {
  if (written === null) return null
  const letters = written.toUpperCase().replace(/\b(CLASS|CLASE|TIPO|TYPE)\b/g, '').replace(/[^A-Z0-9]/g, '')
  return letters === '' ? null : letters
}

/**
 * Below the kit's rating is short. So is a fuse above what its cable carries (the engine's own rule) when that cable
 * is too thin to run in parallel; on a cable that may, the cable must be enough runs. A class other than the kit's, or
 * fewer fuses than the kit's carry together, leaves it to confirm. Fuses rated under the kit's protect something else,
 * a charge controller or a string, so they are not counted.
 */
function checkFuse(x: QuoteExtraction, kit: KitNeeds): ItemCheck {
  const lines = ofKind(x, 'fuse', false)
  if (lines.length === 0) return absent('fuse', x, 'fuse')
  const rated = lines.filter((l) => l.specs.fuseAmps !== null)
  if (rated.length === 0) return check('fuse', 'unknown', { sizeUnknown: true }, sourceOf(lines))
  const top = rated.reduce((a, b) => ((b.specs.fuseAmps ?? 0) > (a.specs.fuseAmps ?? 0) ? b : a))
  const amps = top.specs.fuseAmps ?? 0
  if (amps < kit.fuseA) return check('fuse', 'short', { amps }, top.source)
  const wiring = ofKind(x, 'wiring', false)
  const cable = thickest(wiring)
  const ampacity = cable === null ? null : runAmpacity(cable.size.mm2, kit)
  // A fuse no larger than the kit's own never fails for its size, even where the kit's own cable falls short of it.
  if (cable !== null && ampacity !== null && amps > Math.max(ampacity, kit.fuseA)) {
    const gauge = cable.size.label
    if (cable.size.mm2 < PARALLEL_MIN_MM2 * MM2_TOLERANCE) return check('fuse', 'short', { amps, gauge, maxA: Math.round(ampacity) }, top.source)
    const runs = runsFor(amps, ampacity)
    if (!hasLeads(wiring, cable.size.mm2, runs)) return check('fuse', 'unknown', { amps, gauge, runs, runsUnstated: true }, top.source)
  }
  const main = rated.filter((l) => (l.specs.fuseAmps ?? 0) >= kit.fuseA)
  const otherClass = main.map((l) => fuseClassOf(l.specs.fuseClass)).find((c): c is string => c !== null && c !== kit.fuseClass)
  if (otherClass !== undefined) return check('fuse', 'unknown', { amps, fuseClass: otherClass }, top.source)
  const carriesA = sum(main, (l) => (l.specs.fuseAmps ?? 0) * l.qty)
  if (carriesA < kit.fuseA * kit.fuseCount) return check('fuse', 'unknown', { amps, fuses: sum(main, (l) => l.qty) }, top.source)
  return check('fuse', 'ok', { amps }, top.source)
}

function checkInstallation(x: QuoteExtraction): ItemCheck {
  const lines = ofKind(x, 'labor', false)
  return lines.length ? check('installation', 'ok', {}, sourceOf(lines)) : absent('installation', x, 'labor')
}

function checkWarranty(x: QuoteExtraction): ItemCheck {
  if (x.warranties.length === 0) return check('warranty', 'unknown')
  const years = (kind: 'battery' | 'inverter'): ItemFacts => {
    const ys = x.warranties.filter((w) => w.kind === kind).map((w) => w.years)
    if (ys.length === 0) return {}
    return kind === 'battery' ? { batteryYears: Math.max(...ys) } : { inverterYears: Math.max(...ys) }
  }
  return check('warranty', 'ok', { ...years('battery'), ...years('inverter') })
}

function applyOverride(c: ItemCheck, o: Override | undefined): ItemCheck {
  if (!o) return c
  return { ...c, status: o === 'included' ? 'ok' : 'missing', facts: { ...c.facts, confirmed: true } }
}

/** Every item of a quote judged against the kit, in ITEM_IDS order; the user's overrides win. */
export function checkItems(x: QuoteExtraction, kit: KitNeeds, overrides: Overrides = {}): ItemCheck[] {
  const raw: Record<ItemId, ItemCheck> = {
    inverter: checkInverter(x, kit),
    battery: checkBattery(x, kit),
    charger: checkFeature(x, { id: 'charger', kind: 'charger', flag: 'hasCharger' }),
    wifi: checkFeature(x, { id: 'wifi', kind: 'monitoring', flag: 'hasWifi' }),
    cables: checkCables(x, kit),
    fuse: checkFuse(x, kit),
    installation: checkInstallation(x),
    warranty: checkWarranty(x),
  }
  return ITEM_IDS.map((id) => applyOverride(raw[id], overrides[id]))
}
