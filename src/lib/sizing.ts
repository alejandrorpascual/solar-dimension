import {
  CHEMISTRIES, FUSES, GAUGES, INVERTERS, needsSplitPhase, SIZING, VOLTAGES,
  type CatalogItem, type Chemistry, type ChemistryId, type Inverter, type Voltage,
} from './catalog'
import { panelsToRefill, sizeSolar, type SolarChoice, type SolarPick } from './solar'

export interface CustomLoadLike { id: string; name: string; watts: number; surge: number; note: string }

export interface SizingInput {
  qty: Record<string, number>
  custom?: readonly CustomLoadLike[]
  hours: number
  volts: Voltage
  chemistry: ChemistryId
  runLengthM?: number
  /** A battery unit id such as "12-200" (volts-Ah); null or unavailable means the automatic pick. */
  batteryUnit?: string | null
  solar?: SolarChoice | null
}

export interface SelectedItem extends CatalogItem { qty: number; totalWatts: number; wh: number }
export interface InverterPick { w: number; surge: number; volts: readonly Voltage[]; voltsOk: boolean }
export interface BatteryPick {
  unitLabel: string; unitV: number; unitAh: number; unitWh: number
  series: number; parallel: number; count: number; config: string
  bankWh: number; usableWh: number; bankAh: number; hoursActual: number
}
/** One battery unit that can build this bank, with the bank it would make. */
export interface BatteryOption {
  id: string; label: string; unitV: number; unitAh: number
  count: number; series: number; parallel: number; config: string; bankWh: number; hoursActual: number; isAuto: boolean
}
export interface CablePick {
  amps: number; perRun: number; runs: number; gauge: string; mm2: number; ampacity: number
  mainCount: number; mainLengthM: number; seriesLinks: number; parallelLinks: number; linkLengthM: number
  totalLengthM: number; fuseA: number; dropPct: number
}
export type WarningCode = 'inverterVoltage' | 'highCurrent' | 'parallelStrings' | 'dominantLoad' | 'splitPhase' | 'missingAppliances' | 'roofLimited'
export interface WarningParams {
  inverterW?: number; volts?: number; voltsList?: string; amps?: number; nextVolts?: number | null
  strings?: number; itemId?: string; itemName?: string; sharePct?: number; count?: number
  fit?: number; need?: number
}
export interface Warning { code: WarningCode; params: WarningParams }
export interface SizingResult {
  empty: boolean; items: SelectedItem[]; count: number
  hours: number; volts: Voltage; chemistry: ChemistryId; chemistryLabel: string
  runningW: number; surgeW: number; largestSurgeName: string; largestSurgeId: string
  /** Duty-weighted energy over the window, and the average draw it implies (what the runtime is based on). */
  loadWh: number; averageW: number; requiredWh: number; requiredAh: number
  inverter: InverterPick; battery: BatteryPick | null
  /** The solar side, or null for a battery-only kit. */
  solar: SolarPick | null
  cable: CablePick; warnings: Warning[]
  batteryOptions: BatteryOption[]
  /** The unit actually used when it came from the user's choice; null when the automatic pick is in effect. */
  batteryUnit: string | null
}

const HOURS_RANGE = [1, 72] as const
const RUN_LENGTH_RANGE = [0.5, 10] as const
const DEFAULT_RUN_LENGTH_M = 1.5
const FUSE_MARGIN = 1.1

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const sum = <T>(list: readonly T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0)

export function catalog(appliances: readonly CatalogItem[], custom: readonly CustomLoadLike[] = []): CatalogItem[] {
  const extra: CatalogItem[] = custom.map((c) => ({
    id: c.id, name: c.name, cat: 'Custom', watts: c.watts, surge: c.surge, duty: 1, note: c.note, isCustom: true,
  }))
  return [...appliances, ...extra]
}

function selectItems(items: readonly CatalogItem[], qty: Record<string, number>, hours: number): SelectedItem[] {
  return items
    .filter((a) => (qty[a.id] ?? 0) > 0)
    .map((a) => {
      const n = Math.trunc(qty[a.id] ?? 0)
      return { ...a, qty: n, totalWatts: a.watts * n, wh: Math.round(a.watts * a.duty * hours * n) }
    })
}

function pickInverter(runningW: number, surgeW: number, volts: Voltage): Inverter {
  const needW = runningW * SIZING.HEADROOM
  const fits = (inv: Inverter) => inv.w >= needW && inv.surge >= surgeW
  return (
    INVERTERS.find((inv) => inv.volts.includes(volts) && fits(inv)) ??
    INVERTERS.find(fits) ??
    INVERTERS[INVERTERS.length - 1]!
  )
}

const unitId = (v: number, ah: number) => `${v}-${ah}`

/** Every bank this chemistry can build at this voltage, ordered bank-voltage units first, then by capacity. */
function batteryCandidates(chem: Chemistry, volts: Voltage, requiredAh: number): Array<BatteryPick & { id: string }> {
  return chem.units
    .filter((u) => volts % u.v === 0)
    .map((u) => {
      const series = volts / u.v
      const parallel = Math.max(1, Math.ceil(requiredAh / u.ah))
      const count = series * parallel
      const bankWh = u.v * u.ah * count
      return {
        id: unitId(u.v, u.ah),
        unitLabel: `${u.v} V ${u.ah} Ah ${chem.short}`, unitV: u.v, unitAh: u.ah, unitWh: u.v * u.ah,
        series, parallel, count, config: `${series}S${parallel}P`,
        bankWh, usableWh: Math.round(bankWh * chem.dod), bankAh: u.ah * parallel, hoursActual: 0,
      }
    })
    .sort((a, b) => b.unitV - a.unitV || a.unitAh - b.unitAh)
}

interface RuntimeContext { chem: Chemistry; loadWh: number; hours: number }

/** How many hours a bank of this size runs the load. */
function runtimeHours(bankWh: number, ctx: RuntimeContext): number {
  if (ctx.loadWh <= 0) return 0
  return (bankWh * ctx.chem.dod * SIZING.INVERTER_EFF) / (ctx.loadWh / ctx.hours)
}

/** Strip the candidate id and fill in how long this bank runs the load. */
function toBatteryPick(candidate: (BatteryPick & { id: string }) | null, ctx: RuntimeContext): BatteryPick | null {
  if (!candidate) return null
  const { id: _id, ...pick } = candidate
  return { ...pick, hoursActual: runtimeHours(pick.bankWh, ctx) }
}

/** The automatic pick: fewest batteries, then the smallest bank that still covers the load. */
function autoPick<T extends { count: number; bankWh: number }>(candidates: readonly T[]): T | null {
  return [...candidates].sort((a, b) => a.count - b.count || a.bankWh - b.bankWh)[0] ?? null
}

function sizeCable(inverterW: number, volts: Voltage, runLengthM: number) {
  const amps = inverterW / volts / SIZING.INVERTER_EFF
  const top = GAUGES[GAUGES.length - 1]!
  let runs = 1
  while (amps / runs > top.amps) runs++
  const perRun = amps / runs
  const dropPct = (ohmPerM: number) => ((2 * runLengthM * perRun * ohmPerM) / volts) * 100
  let gi = GAUGES.findIndex((g) => g.amps >= perRun)
  if (gi < 0) gi = GAUGES.length - 1
  while (gi < GAUGES.length - 1 && dropPct(GAUGES[gi]!.ohmPerM) > SIZING.MAX_DROP_PCT) gi++
  const fuseA = FUSES.find((f) => f >= perRun * FUSE_MARGIN) ?? FUSES[FUSES.length - 1]!
  while (gi < GAUGES.length - 1 && fuseA > GAUGES[gi]!.amps) gi++
  const g = GAUGES[gi]!
  return { amps, perRun, runs, gauge: g.awg, mm2: g.mm2, ampacity: g.amps, fuseA: Math.min(fuseA, g.amps), dropPct: dropPct(g.ohmPerM) }
}

interface WarningContext {
  items: SelectedItem[]; inverter: Inverter; inverterVoltsOk: boolean
  amps: number; volts: Voltage; battery: BatteryPick | null; loadWh: number
}

function buildWarnings(ctx: WarningContext): Warning[] {
  if (ctx.items.length === 0) return []
  const w: Warning[] = []
  if (!ctx.inverterVoltsOk) {
    w.push({ code: 'inverterVoltage', params: { inverterW: ctx.inverter.w, voltsList: ctx.inverter.volts.join(' / ') } })
  }
  if (ctx.amps > SIZING.MAX_PRACTICAL_AMPS) {
    w.push({ code: 'highCurrent', params: { amps: Math.round(ctx.amps), volts: ctx.volts, nextVolts: VOLTAGES.find((v) => v > ctx.volts) ?? null } })
  }
  if (ctx.battery && ctx.battery.parallel > SIZING.MAX_PARALLEL_STRINGS) {
    w.push({ code: 'parallelStrings', params: { strings: ctx.battery.parallel } })
  }
  const dominant = ctx.items.find((i) => ctx.loadWh > 0 && i.wh / ctx.loadWh > SIZING.DOMINANT_SHARE)
  if (dominant) {
    w.push({ code: 'dominantLoad', params: { itemId: dominant.id, itemName: dominant.name, sharePct: Math.round((dominant.wh / ctx.loadWh) * 100) } })
  }
  const heavy = ctx.items.find(needsSplitPhase)
  if (heavy) {
    w.push({ code: 'splitPhase', params: { itemId: heavy.id, itemName: heavy.name } })
  }
  return w
}

/**
 * Appliances the project counts that this catalog does not have, e.g. while the fallback snapshot is served or a
 * row failed validation. They cannot be sized, so the kit says how many it left out instead of hiding them.
 */
function missingCount(list: readonly CatalogItem[], qty: Record<string, number>): number {
  const known = new Set(list.map((i) => i.id))
  return Object.entries(qty).filter(([id, n]) => n > 0 && !known.has(id)).length
}

export function compute(input: SizingInput, appliances: readonly CatalogItem[]): SizingResult {
  const hours = clamp(finite(input.hours, 10), HOURS_RANGE[0], HOURS_RANGE[1])
  const volts: Voltage = VOLTAGES.includes(input.volts) ? input.volts : 48
  const chem = CHEMISTRIES[input.chemistry] ?? CHEMISTRIES.lifepo4
  const runLengthM = clamp(finite(input.runLengthM, DEFAULT_RUN_LENGTH_M), RUN_LENGTH_RANGE[0], RUN_LENGTH_RANGE[1])

  const list = catalog(appliances, input.custom)
  const items = selectItems(list, input.qty ?? {}, hours)
  const missing = missingCount(list, input.qty ?? {})
  const runningW = sum(items, (i) => i.totalWatts)
  const largest = items.reduce<SelectedItem | null>(
    (best, i) => (i.surge - i.watts > (best ? best.surge - best.watts : -1) ? i : best), null,
  )
  const surgeW = runningW + (largest ? largest.surge - largest.watts : 0)
  const loadWh = sum(items, (i) => i.wh)
  const requiredWh = loadWh / SIZING.INVERTER_EFF / chem.dod
  const requiredAh = requiredWh / volts

  const inverter = pickInverter(runningW, surgeW, volts)
  const inverterVoltsOk = inverter.volts.includes(volts)
  const candidates = batteryCandidates(chem, volts, requiredAh)
  const auto = autoPick(candidates)
  const chosen = candidates.find((c) => c.id === input.batteryUnit) ?? null
  const battery = toBatteryPick(chosen ?? auto, { chem, loadWh, hours })
  const cable = sizeCable(inverter.w, volts, runLengthM)
  const averageW = Math.round(loadWh / hours)
  // An empty project still gets a (smallest) bank from autoPick; panels for it would be nonsense, so size against 0.
  const bankWh = items.length === 0 ? 0 : battery?.bankWh ?? 0
  const solar = sizeSolar({ solar: input.solar ?? null, bankWh, volts, averageW })
  const roofWarning: Warning[] = solar && items.length > 0 && solar.isRoofLimited
    ? [{ code: 'roofLimited', params: { fit: solar.fit, need: panelsToRefill(bankWh, solar.sunHours) } }]
    : []
  const seriesLinks = battery ? (battery.series - 1) * battery.parallel : 0
  const parallelLinks = battery ? 2 * (battery.parallel - 1) : 0
  const linkLengthM = SIZING.LINK_LENGTH_M

  return {
    empty: items.length === 0,
    items,
    count: sum(items, (i) => i.qty),
    hours, volts, chemistry: chem.id, chemistryLabel: chem.label,
    runningW, surgeW, largestSurgeName: largest?.name ?? '', largestSurgeId: largest?.id ?? '',
    loadWh, averageW, requiredWh: Math.round(requiredWh), requiredAh: Math.round(requiredAh),
    inverter: { w: inverter.w, surge: inverter.surge, volts: inverter.volts, voltsOk: inverterVoltsOk },
    battery,
    solar,
    cable: {
      amps: Math.round(cable.amps), perRun: Math.round(cable.perRun), runs: cable.runs,
      gauge: cable.gauge, mm2: cable.mm2, ampacity: cable.ampacity,
      mainCount: 2 * cable.runs, mainLengthM: runLengthM,
      seriesLinks, parallelLinks, linkLengthM,
      totalLengthM: Math.round((2 * cable.runs * runLengthM + (seriesLinks + parallelLinks) * linkLengthM) * 10) / 10,
      fuseA: cable.fuseA, dropPct: Math.round(cable.dropPct * 10) / 10,
    },
    warnings: [
      ...buildWarnings({ items, inverter, inverterVoltsOk, amps: cable.amps, volts, battery, loadWh }),
      ...roofWarning,
      ...(missing > 0 ? [{ code: 'missingAppliances' as const, params: { count: missing } }] : []),
    ],
    batteryOptions: candidates.map((c) => ({
      id: c.id, label: c.unitLabel, unitV: c.unitV, unitAh: c.unitAh,
      count: c.count, series: c.series, parallel: c.parallel, config: c.config, bankWh: c.bankWh,
      hoursActual: runtimeHours(c.bankWh, { chem, loadWh, hours }), isAuto: c.id === auto?.id,
    })),
    batteryUnit: chosen?.id ?? null,
  }
}
