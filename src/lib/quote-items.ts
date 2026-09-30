import { CHEMISTRIES, GAUGES, SIZING, type ChemistryId } from './catalog'
import type { LineKind, QuoteExtraction, QuoteLine } from './quote-schema'
import type { SizingResult } from './sizing'

export const ITEM_IDS = ['inverter', 'battery', 'charger', 'wifi', 'cables', 'fuse', 'installation', 'warranty'] as const
export type ItemId = (typeof ITEM_IDS)[number]
/** The five items shown as icons in a quote's row. */
export const STRIP_ITEMS: readonly ItemId[] = ['charger', 'wifi', 'cables', 'fuse', 'installation']

/** ok = meets the kit · short = there but too small · missing = excluded or only optional · unknown = not mentioned */
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
}

export function kitNeeds(r: SizingResult): KitNeeds {
  return {
    runningW: r.runningW, surgeW: r.surgeW, usableWh: r.loadWh / SIZING.INVERTER_EFF, chemistry: r.chemistry,
    cableMm2: r.cable.mm2, cableGauge: r.cable.gauge, fuseA: r.cable.fuseA,
  }
}

/** What an item check found, as numbers; quote-text.ts turns them into words. */
export interface ItemFacts {
  watts?: number; surgeWatts?: number; surgeUnknown?: boolean; shortW?: number; shortSurgeW?: number
  usableWh?: number; shortWh?: number
  builtIn?: boolean; amps?: number
  gauge?: string; sizeUnknown?: boolean
  optionalPrice?: number
  batteryYears?: number; inverterYears?: number
  confirmed?: boolean
}
export interface ItemCheck { id: ItemId; status: ItemStatus; facts: ItemFacts; source: QuoteLine['source'] | null }

const MM2_TOLERANCE = 0.95

const check = (id: ItemId, status: ItemStatus, facts: ItemFacts = {}, source: QuoteLine['source'] | null = null): ItemCheck =>
  ({ id, status, facts, source })
const ofKind = (x: QuoteExtraction, kind: LineKind, optional: boolean): QuoteLine[] =>
  x.lines.filter((l) => l.kind === kind && l.optional === optional)
const sum = (ls: readonly QuoteLine[], f: (l: QuoteLine) => number): number => ls.reduce((a, l) => a + f(l), 0)
const sourceOf = (ls: readonly QuoteLine[]): QuoteLine['source'] | null => ls[0]?.source ?? null
const cheapest = (ls: readonly QuoteLine[]): number => Math.min(...ls.map((l) => l.lineTotal))

/** No included line of `kind`: missing when the quote offers it only as an optional extra, otherwise unknown. */
function absent(id: ItemId, x: QuoteExtraction, kind: LineKind): ItemCheck {
  const extras = ofKind(x, kind, true)
  return extras.length ? check(id, 'missing', { optionalPrice: cheapest(extras) }, sourceOf(extras)) : check(id, 'unknown')
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
const dodOf = (l: QuoteLine, fallback: ChemistryId): number =>
  CHEMISTRIES[l.specs.chemistry === 'lifepo4' || l.specs.chemistry === 'agm' ? l.specs.chemistry : fallback].dod

function checkBattery(x: QuoteExtraction, kit: KitNeeds): ItemCheck {
  const lines = ofKind(x, 'battery', false)
  const sized = lines.filter((l) => lineWh(l) !== null)
  if (sized.length === 0) return check('battery', 'unknown', {}, sourceOf(lines))
  const usableWh = sum(sized, (l) => (lineWh(l) ?? 0) * l.qty * dodOf(l, kit.chemistry))
  const shortWh = Math.max(0, kit.usableWh - usableWh)
  return check('battery', shortWh > 0 ? 'short' : 'ok', { usableWh, ...(shortWh > 0 ? { shortWh } : {}) }, sourceOf(sized))
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

/** mm² for an AWG size written as "2/0", "2/0 AWG" or "#4"; null when it isn't in the gauge table. */
export function gaugeMm2(awg: string | null): number | null {
  if (awg === null) return null
  const key = awg.toUpperCase().replace(/^#/, '').replace(/AWG/g, '').trim()
  return GAUGES.find((g) => g.awg.replace(' AWG', '') === key)?.mm2 ?? null
}

function checkCables(x: QuoteExtraction, kit: KitNeeds): ItemCheck {
  const lines = ofKind(x, 'wiring', false)
  if (lines.length === 0) return absent('cables', x, 'wiring')
  const sized = lines.flatMap((l) => {
    const mm2 = l.specs.mm2 ?? gaugeMm2(l.specs.awg)
    return mm2 === null ? [] : [{ l, mm2 }]
  })
  if (sized.length === 0) return check('cables', 'ok', { sizeUnknown: true }, sourceOf(lines))
  const top = sized.reduce((a, b) => (b.mm2 > a.mm2 ? b : a))
  const gauge = top.l.specs.awg ? `${top.l.specs.awg.replace(/\s*AWG$/i, '')} AWG` : `${top.mm2} mm²`
  return check('cables', top.mm2 < kit.cableMm2 * MM2_TOLERANCE ? 'short' : 'ok', { gauge }, top.l.source)
}

function checkFuse(x: QuoteExtraction, kit: KitNeeds): ItemCheck {
  const lines = ofKind(x, 'fuse', false)
  if (lines.length === 0) return absent('fuse', x, 'fuse')
  const rated = lines.filter((l) => l.specs.fuseAmps !== null)
  if (rated.length === 0) return check('fuse', 'ok', { sizeUnknown: true }, sourceOf(lines))
  const amps = Math.max(...rated.map((l) => l.specs.fuseAmps ?? 0))
  return check('fuse', amps < kit.fuseA ? 'short' : 'ok', { amps }, sourceOf(rated))
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
