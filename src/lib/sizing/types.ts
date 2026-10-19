import type { BmsComms, CatalogItem, ChemistryId, FuseClass, InsulationC, LoadKind, SurgeClass, Voltage } from '../catalog'
import type { SolarChoice, SolarPick } from '../solar'

export interface CustomLoadLike { id: string; name: string; watts: number; surge: number; note: string }

/** How many motors may start in the same instant: a count, or every one at once (a grid drop with nothing staged). */
export type SimultaneousStarts = number | 'all'

/** Where the battery-to-inverter run is installed; the NEC corrections read from these. */
export interface CableConditions {
  /** One-way length of the main run, metres. */
  runLengthM: number
  ambientC: number
  /** Whether every run shares one conduit or bundle (two current-carrying conductors per run then count together). */
  bundled: boolean
  insulationC: InsulationC
}

export interface SizingInput {
  qty: Record<string, number>
  custom?: readonly CustomLoadLike[]
  hours: number
  volts: Voltage
  chemistry: ChemistryId
  /** @deprecated Use cable.runLengthM; still honoured when `cable` carries no length. */
  runLengthM?: number
  /** A battery unit id such as "12-200" (volts-Ah); null or unavailable means the automatic pick. */
  batteryUnit?: string | null
  /** Roof, panel count and sun hours from the solar step; null or absent for a battery-only kit. */
  solar?: SolarChoice | null
  /** Share of each hour an appliance runs, by id, when the user changed it from the catalog value. */
  dutyOverrides?: Record<string, number>
  simultaneousStarts?: SimultaneousStarts
  cable?: Partial<CableConditions>
}

export interface SelectedItem extends CatalogItem {
  qty: number
  totalWatts: number
  wh: number
  kind: LoadKind
  /** Duty actually used: the override, the momentary burst math, or the catalog duty. */
  effectiveDuty: number
  overridden: boolean
  /** The surge class in effect (stated or derived); null when the appliance has no start-up surge. */
  startClass: SurgeClass | null
  surgeSeconds: number
  /** Surge above running watts for one unit. */
  surgeDelta: number
}

export interface SurgeStarter { itemId: string; itemName: string; delta: number; seconds: number }
/** The start-up the inverter must ride: which units were assumed to start together, and for how long. */
export interface SurgeProfile { surgeW: number; seconds: number; starters: SurgeStarter[] }

/** The kit's inverter: one unit, or identical units in parallel. Every rating and current is the whole set's. */
export interface InverterPick {
  /** Units working in parallel as one; 1 for a single inverter. */
  count: number
  /** One unit's continuous rating, as sold; `w` is `count` of them. */
  unitW: number
  w: number
  surge: number
  volts: readonly Voltage[]
  voltsOk: boolean
  surgeSeconds: number
  surgeLong: { w: number; seconds: number } | null
  /** The surge rating that applies to the load's surge duration, and whether it covers the peak. */
  surgeRatedW: number
  surgeOk: boolean
  /** Whether the continuous rating covers the running load at all, and with the engine's headroom on top; the second implies the first. */
  runningOk: boolean
  headroomOk: boolean
  /** DC-side current at full continuous output and at the surge rating. */
  continuousA: number
  surgeA: number
}

export interface RuntimeScenarios {
  optimistic: number
  typical: number
  worst: number
  /** Worst case is 0 because the bank cannot feed the full running load at all. */
  worstLimitedByDischarge: boolean
}

export interface BatteryLimits {
  maxContinuousA: number
  peakA: number
  peakSeconds: number
  maxParallel: number
  bmsComms: BmsComms
  shortCircuitA: number
}

export interface BatteryPick {
  unitLabel: string
  unitV: number
  unitAh: number
  unitWh: number
  series: number
  parallel: number
  count: number
  config: string
  bankWh: number
  usableWh: number
  bankAh: number
  /** The typical runtime, kept for the tiles and the deltas; equals runtime.typical. */
  hoursActual: number
  runtime: RuntimeScenarios
  unit: BatteryLimits
  bankContinuousA: number
  bankPeakA: number
  bankShortCircuitA: number
  /**
   * Strings each requirement alone would need: the energy, the BMS continuous and peak limits, and what one string's
   * lead carries. Parallel is the largest of the first three, or the energy's when that passes the unit's limit. The
   * lead's count raises it only when there is already more than one string (one has no lead of its own), the unit's
   * limit allows that many and the fuses could still interrupt the bank; otherwise `leadOk` is false.
   */
  parallelFor: { energy: number; continuous: number; peak: number; lead: number }
  dischargeOk: boolean
  peakOk: boolean
  overMaxParallel: boolean
  /** No string is asked for more than its lead carries; true for one string, which has none. */
  leadOk: boolean
  /** The fuses this bank's kit gets can interrupt its fault current: the main fuse all of it, each string's fuse one battery's. */
  interruptOk: boolean
}

/** One battery unit that can build this bank, with the bank it would make. */
export interface BatteryOption {
  id: string
  label: string
  unitV: number
  unitAh: number
  count: number
  series: number
  parallel: number
  config: string
  bankWh: number
  hoursActual: number
  isAuto: boolean
  runtime: RuntimeScenarios
  dischargeOk: boolean
  peakOk: boolean
  overMaxParallel: boolean
  leadOk: boolean
  interruptOk: boolean
  maxParallel: number
}

export interface FusePick { a: number; class: FuseClass; aicA: number; maxVdc: number; count: number }

/** A battery-side cable row the parts list prints. The values are those rows' part ids, so a warning can name its row. */
export type ConductorKind = 'mainCable' | 'interconnects' | 'stringLeads'

/**
 * The jumpers between neighbouring batteries in a string. Every link passes the whole string's current. The currents
 * are whole amps for printing; whether the row falls short is the `cableUndersized` warning's call, not theirs.
 */
export interface LinkCable {
  /** Links in the bank: one between each pair of neighbours, in every string. */
  positions: number
  /** Jumpers side by side at each link: the main cable's runs in a one-string bank, otherwise one. */
  perPosition: number
  /** Jumpers to buy: positions × perPosition. */
  count: number
  gauge: string
  mm2: number
  /** Design current of one jumper: that of the conductor its string feeds, split over that conductor's runs. */
  designA: number
  /** What one jumper may carry: the table column corrected for ambient, unbundled, capped at the terminations. */
  ampacity: number
  lengthM: number
}

/**
 * The leads from one parallel string to the bus bars, and the fuse on the positive one; `fuse.count` is the number of
 * strings. The currents are whole amps for printing, as on `LinkCable`.
 */
export interface StringCable {
  amps: number
  designA: number
  gauge: string
  mm2: number
  ampacity: number
  lengthM: number
  dropPct: number
  fuse: FusePick
  /** Leads to buy: a positive and a negative for every string. */
  leads: number
  /** Everything sizing the lead warned about: its fuse, the drop, the air, and the lead against its design current. */
  warnings: Warning[]
}

export interface CablePick {
  /** The whole circuit's continuous current, and one run's share of it. */
  amps: number
  perRun: number
  /** Runs in all. Inverters in parallel each get their own, so there are `runs / inverter.count` to each. */
  runs: number
  gauge: string
  mm2: number
  /** Ampacity of one run after the ambient and bundling corrections and the termination cap. */
  ampacity: number
  tableAmpacity: number
  /** Design current of the whole battery-to-inverter circuit, all runs together: continuous amps × the NEC continuous factor. */
  designA: number
  /** Design current of one run, in whole amps: the figure the main cable row and the cable check print. */
  designPerRunA: number
  insulationC: InsulationC
  ambientC: number
  ambientFactor: number
  bundled: boolean
  conductors: number
  bundleFactor: number
  mainCount: number
  mainLengthM: number
  /** Series links inside each string; null when no two batteries are in series. */
  links: LinkCable | null
  /** Metres of battery-side cable in the kit: main runs, links and string leads together, whatever their gauges. */
  totalLengthM: number
  /** The main fuse rating; the same value as `fuse.a` on the result. */
  fuseA: number
  dropPct: number
  /** Drop at the inverter's surge current. */
  startupDropPct: number
  /** The lead pair and fuse of each parallel string; null when the bank is one string. */
  string: StringCable | null
}

export type WarningCode =
  | 'inverterVoltage' | 'highCurrent' | 'parallelStrings' | 'dominantLoad' | 'splitPhase'
  | 'inverterUndersized' | 'surgeDuration' | 'bankDischarge' | 'bankPeak' | 'fuseAboveBank' | 'fuseAboveCable' | 'fuseSurge' | 'fuseInterrupt' | 'startupDrop' | 'cableAmbient'
  | 'cableUndersized'
  | 'missingAppliances'
  | 'roofLimited' | 'stringTooShort'

export interface WarningParams {
  /** The inverter's rating: the whole set's when units work in parallel, with how many there are and one unit's rating. */
  inverterW?: number
  inverters?: number
  unitW?: number
  runningW?: number
  /**
   * Whole percent of headroom the inverter has over the running load, and the percent the engine plans for. The first
   * is 0 at the rating and past it alike; `inverterW` against `runningW` tells the two apart.
   */
  headroomPct?: number
  needPct?: number
  volts?: number
  voltsList?: string
  amps?: number
  nextVolts?: number | null
  strings?: number
  itemId?: string
  itemName?: string
  sharePct?: number
  count?: number
  maxParallel?: number
  unitLabel?: string
  needA?: number
  maxA?: number
  seconds?: number
  surgeW?: number
  ratedW?: number
  /**
   * For a start-up the inverter cannot hold: the most the inverter holds in a surge, and whether the start-up is within
   * that and fails only because it outlasts the window. When false its watts are over the rating at any length.
   */
  inverterSurgeW?: number
  tooLong?: boolean
  fuseA?: number
  surgeA?: number
  shortCircuitA?: number
  aicA?: number
  dropPct?: number
  ambientC?: number
  conductor?: ConductorKind
  gauge?: string
  /** Whether a short cable row would cover its design current in a cool room, and on 90 °C cable. */
  canCool?: boolean
  canRaiseInsulation?: boolean
  fit?: number
  need?: number
}
export interface Warning { code: WarningCode; params: WarningParams }

/** Installation notes a bank with parallel strings needs; translated by the UI. */
export type ParallelNote = 'sameModelAge' | 'equalLeadsOrBusbar' | 'stringFuses' | 'bmsComms'
/** Installation notes inverters working in parallel need; translated by the UI. */
export type InverterNote = 'builtForParallel' | 'ownRunAndFuse'

export interface SizingResult {
  empty: boolean
  items: SelectedItem[]
  count: number
  hours: number
  volts: Voltage
  chemistry: ChemistryId
  chemistryLabel: string
  runningW: number
  surgeW: number
  surgeSeconds: number
  surgeProfile: SurgeProfile
  simultaneousStarts: SimultaneousStarts
  largestSurgeName: string
  largestSurgeId: string
  /** Duty-weighted energy over the window, and the average draw it implies (what the runtime is based on). */
  loadWh: number
  averageW: number
  requiredWh: number
  requiredAh: number
  inverter: InverterPick
  battery: BatteryPick | null
  /** The solar side, or null for a battery-only kit. */
  solar: SolarPick | null
  cable: CablePick
  fuse: FusePick
  parallelNotes: ParallelNote[]
  /** Empty for a single inverter. */
  inverterNotes: InverterNote[]
  warnings: Warning[]
  batteryOptions: BatteryOption[]
  /** The unit actually used when it came from the user's choice; null when the automatic pick is in effect. */
  batteryUnit: string | null
}
