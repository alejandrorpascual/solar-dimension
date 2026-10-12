import { DEFAULT_HARDWARE, SIZING, VOLTAGES, type CatalogItem, type HardwareCatalog, type Voltage } from './catalog'
import { ambientFactor, ampsAt, bundleFactor } from './nec'
import { autoPick, batteryCandidates, toBatteryPick, type BankCandidate } from './sizing/battery'
import { sizeBankWiring, sizeMainCable, undersized } from './sizing/cable'
import { dcAmps, pickInverter, toInverterPick } from './sizing/inverter'
import { selectItems, surgeProfile } from './sizing/loads'
import { runtimeScenarios, type RuntimeContext } from './sizing/runtime'
import type {
  BatteryOption, BatteryPick, CableConditions, CustomLoadLike, SelectedItem, SimultaneousStarts, SizingInput, SizingResult, Warning,
} from './sizing/types'
import { buildWarnings, inverterNotes, parallelNotes } from './sizing/warnings'
import { panelsToRefill, sizeSolar, type SolarPick } from './solar'

export type * from './sizing/types'

const HOURS_RANGE = [1, 72] as const
const RUN_LENGTH_RANGE = [0.5, 10] as const
const AMBIENT_RANGE = [-10, 80] as const
const DEFAULT_RUN_LENGTH_M = 1.5
const DEFAULT_INSULATION_C = 90

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const sum = <T>(list: readonly T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0)
const tenth = (n: number) => Math.round(n * 10) / 10

export function catalog(appliances: readonly CatalogItem[], custom: readonly CustomLoadLike[] = []): CatalogItem[] {
  const extra: CatalogItem[] = custom.map((c) => ({
    id: c.id, name: c.name, cat: 'Custom', watts: c.watts, surge: c.surge, duty: 1, note: c.note, isCustom: true,
  }))
  return [...appliances, ...extra]
}

/**
 * Appliances the project counts that this catalog does not have, e.g. while the fallback snapshot is served or a
 * row failed validation. They cannot be sized, so the kit says how many it left out instead of hiding them.
 */
function missingCount(list: readonly CatalogItem[], qty: Record<string, number>): number {
  const known = new Set(list.map((i) => i.id))
  return Object.entries(qty).filter(([id, n]) => n > 0 && !known.has(id)).length
}

function normalizeStarts(v: SimultaneousStarts | undefined): SimultaneousStarts {
  if (v === 'all') return 'all'
  return Math.max(1, Math.trunc(finite(v, SIZING.DEFAULT_SIMULTANEOUS_STARTS)))
}

function normalizeCable(input: SizingInput): CableConditions {
  const c = input.cable ?? {}
  return {
    runLengthM: clamp(finite(c.runLengthM ?? input.runLengthM, DEFAULT_RUN_LENGTH_M), RUN_LENGTH_RANGE[0], RUN_LENGTH_RANGE[1]),
    ambientC: clamp(finite(c.ambientC, SIZING.AMBIENT_DEFAULT_C), AMBIENT_RANGE[0], AMBIENT_RANGE[1]),
    bundled: c.bundled === true,
    insulationC: c.insulationC === 75 ? 75 : DEFAULT_INSULATION_C,
  }
}

const largestSurge = (items: readonly SelectedItem[]): SelectedItem | null =>
  items.reduce<SelectedItem | null>((best, i) => (i.surgeDelta > (best ? best.surgeDelta : -1) ? i : best), null)

const toOption = (c: BankCandidate, ctx: RuntimeContext, autoId: string | undefined): BatteryOption => {
  const runtime = runtimeScenarios(c, ctx)
  return {
    id: c.id, label: c.unitLabel, unitV: c.unitV, unitAh: c.unitAh,
    count: c.count, series: c.series, parallel: c.parallel, config: c.config, bankWh: c.bankWh,
    hoursActual: runtime.typical, runtime, isAuto: c.id === autoId,
    dischargeOk: c.dischargeOk, peakOk: c.peakOk, overMaxParallel: c.overMaxParallel, maxParallel: c.unit.maxParallel,
  }
}

/** True when the kit has a solar array worth showing: panels chosen and at least one appliance. */
export const hasPanels = (r: SizingResult): r is SizingResult & { solar: SolarPick } =>
  r.solar !== null && r.solar.panels > 0 && !r.empty

export function compute(input: SizingInput, appliances: readonly CatalogItem[], hardware: HardwareCatalog = DEFAULT_HARDWARE): SizingResult {
  const hours = clamp(finite(input.hours, 10), HOURS_RANGE[0], HOURS_RANGE[1])
  const volts: Voltage = VOLTAGES.includes(input.volts) ? input.volts : 48
  const chem = hardware.chemistries[input.chemistry] ?? hardware.chemistries.lifepo4
  const starts = normalizeStarts(input.simultaneousStarts)
  const cond = normalizeCable(input)

  const list = catalog(appliances, input.custom)
  const items = selectItems(list, input.qty ?? {}, hours, input.dutyOverrides ?? {})
  const missing = missingCount(list, input.qty ?? {})
  const runningW = sum(items, (i) => i.totalWatts)
  const largest = largestSurge(items)
  const profile = surgeProfile(items, runningW, starts)
  const loadWh = sum(items, (i) => i.wh)
  const requiredWh = loadWh / SIZING.INVERTER_EFF / chem.dod
  const requiredAh = requiredWh / volts

  const inverter = toInverterPick(pickInverter(runningW, profile, volts, hardware.inverters), profile, volts, runningW)
  // What flows at start-up is the load's surge, not the inverter's rating: the bank, fuse and cable see that current.
  const startupA = dcAmps(profile.surgeW, volts)
  const demand = { continuousA: inverter.continuousA, surgeA: startupA, surgeSeconds: profile.seconds }
  const candidates = batteryCandidates(chem, volts, requiredAh, demand)
  const auto = autoPick(candidates)
  const chosen = candidates.find((c) => c.id === input.batteryUnit) ?? null
  const bank = chosen ?? auto
  const runtimeCtx: RuntimeContext = { chem, items, hours, loadWh, runningW, volts }
  const battery: BatteryPick | null = bank ? toBatteryPick(bank, runtimeScenarios(bank, runtimeCtx)) : null
  const averageW = Math.round(loadWh / hours)
  // An empty project still gets a (smallest) bank from autoPick; panels for it would be nonsense, so size against 0.
  const bankWh = items.length === 0 ? 0 : battery?.bankWh ?? 0
  const solar = sizeSolar({ solar: input.solar ?? null, bankWh, volts, averageW })
  const roofWarning: Warning[] = solar && items.length > 0 && solar.isRoofLimited
    ? [{ code: 'roofLimited', params: { fit: solar.fit, need: panelsToRefill(bankWh, solar.sunHours) } }]
    : []

  // Inverters in parallel share the current but not the cable: each has its own runs and fuse.
  const main = sizeMainCable(inverter.continuousA, startupA, volts, cond, hardware.gauges, hardware.fuses, {
    surgeSeconds: profile.seconds, bankContinuousA: battery?.bankContinuousA ?? null, bankShortCircuitA: battery?.bankShortCircuitA ?? null,
  }, { feeds: inverter.count })
  const wiring = sizeBankWiring({
    battery, main, bankAmps: inverter.continuousA, bankSurgeAmps: startupA, volts, cond,
    gauges: hardware.gauges, fuses: hardware.fuses, surgeSeconds: profile.seconds,
  })
  const jumpers = (wiring.links?.count ?? 0) + (wiring.string?.leads ?? 0)

  return {
    empty: items.length === 0,
    items,
    count: sum(items, (i) => i.qty),
    hours, volts, chemistry: chem.id, chemistryLabel: chem.label,
    runningW, surgeW: profile.surgeW, surgeSeconds: profile.seconds, surgeProfile: profile, simultaneousStarts: starts,
    largestSurgeName: largest?.name ?? '', largestSurgeId: largest?.id ?? '',
    loadWh, averageW, requiredWh: Math.round(requiredWh), requiredAh: Math.round(requiredAh),
    inverter,
    battery,
    solar,
    cable: {
      amps: Math.round(main.amps), perRun: Math.round(main.perRun), runs: main.runs,
      gauge: main.gauge.awg, mm2: main.gauge.mm2, ampacity: Math.round(main.ampacity), tableAmpacity: ampsAt(main.gauge, cond.insulationC),
      designA: Math.round(main.designA), insulationC: cond.insulationC, ambientC: cond.ambientC,
      ambientFactor: ambientFactor(cond.ambientC, cond.insulationC),
      bundled: cond.bundled, conductors: main.conductors, bundleFactor: bundleFactor(main.conductors),
      mainCount: 2 * main.runs, mainLengthM: cond.runLengthM,
      links: wiring.links,
      totalLengthM: tenth(2 * main.runs * cond.runLengthM + jumpers * SIZING.LINK_LENGTH_M),
      fuseA: main.fuse.a, dropPct: tenth(main.dropPct), startupDropPct: tenth(main.startupDropPct),
      string: wiring.string,
    },
    fuse: main.fuse,
    parallelNotes: parallelNotes(battery),
    inverterNotes: inverterNotes(inverter),
    warnings: [
      ...buildWarnings({
        items, inverter, runningW, surgeProfile: profile, amps: inverter.continuousA, volts, battery, loadWh,
        protection: [...main.warnings, ...undersized('mainCable', main), ...wiring.warnings], missing, startupA,
      }),
      ...roofWarning,
    ],
    batteryOptions: candidates.map((c) => toOption(c, runtimeCtx, auto?.id)),
    batteryUnit: chosen?.id ?? null,
  }
}
