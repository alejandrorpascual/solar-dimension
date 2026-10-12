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

export interface InverterPick {
  w: number
  surge: number
  volts: readonly Voltage[]
  voltsOk: boolean
  surgeSeconds: number
  surgeLong: { w: number; seconds: number } | null
  /** The surge rating that applies to the load's surge duration, and whether it covers the peak. */
  surgeRatedW: number
  surgeOk: boolean
  /** Whether the continuous rating covers the running load at all, and with the engine's headroom on top. */
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
  /** Strings each requirement alone would need; parallel is the largest unless that exceeds the unit's limit. */
  parallelFor: { energy: number; continuous: number; peak: number }
  dischargeOk: boolean
  peakOk: boolean
  overMaxParallel: boolean
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
  maxParallel: number
}

export interface FusePick { a: number; class: FuseClass; aicA: number; maxVdc: number; count: number }

/** A cable row the parts list prints, named by its part id so a warning can point at the row. */
export type ConductorKind = 'mainCable' | 'interconnects' | 'stringLeads'

/** The jumpers between neighbouring batteries in a string. Each place carries the whole string's current. */
export interface LinkCable {
  /** Places a link goes: one between each pair of neighbours, in every string. */
  positions: number
  /** Jumpers side by side at each place: the main cable's runs in a one-string bank, otherwise one. */
  perPosition: number
  /** Jumpers to buy: positions × perPosition. */
  count: number
  gauge: string
  mm2: number
  /** What one jumper is sized for, and what it carries after the ambient correction. */
  designA: number
  ampacity: number
  lengthM: number
}

/** The leads from one parallel string to the bus bars, and the fuse on the positive one. */
export interface StringCable {
  amps: number
  designA: number
  gauge: string
  mm2: number
  ampacity: number
  lengthM: number
  dropPct: number
  fuse: FusePick
  /** Strings in parallel, so fuses to buy. */
  count: number
  /** Leads to buy: a positive and a negative for every string. */
  leads: number
  /** The string fuse's own checks against one unit's limits, and the lead's against its design current. */
  warnings: Warning[]
}

export interface CablePick {
  amps: number
  perRun: number
  runs: number
  gauge: string
  mm2: number
  /** Ampacity of one run after the ambient and bundling corrections and the termination cap. */
  ampacity: number
  tableAmpacity: number
  /** Current the run is sized for: continuous amps × the NEC continuous factor. */
  designA: number
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
  totalLengthM: number
  /** The main fuse rating; the same value as `fuse.a` on the result. */
  fuseA: number
  dropPct: number
  /** Drop at the inverter's surge current. */
  startupDropPct: number
  string: StringCable | null
}

export type WarningCode =
  | 'inverterVoltage' | 'highCurrent' | 'parallelStrings' | 'dominantLoad' | 'splitPhase'
  | 'inverterUndersized' | 'surgeDuration' | 'bankDischarge' | 'bankPeak' | 'fuseAboveBank' | 'fuseAboveCable' | 'fuseSurge' | 'fuseInterrupt' | 'startupDrop' | 'cableAmbient'
  | 'cableUndersized'
  | 'missingAppliances'
  | 'roofLimited'

export interface WarningParams {
  inverterW?: number
  runningW?: number
  /** Whole percent of headroom the inverter has over the running load, and the percent the engine plans for. */
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
  fuseA?: number
  surgeA?: number
  shortCircuitA?: number
  aicA?: number
  dropPct?: number
  ambientC?: number
  conductor?: ConductorKind
  gauge?: string
  fit?: number
  need?: number
}
export interface Warning { code: WarningCode; params: WarningParams }

/** Installation notes a bank with parallel strings needs; translated by the UI. */
export type ParallelNote = 'sameModelAge' | 'equalLeadsOrBusbar' | 'stringFuses' | 'bmsComms'

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
  warnings: Warning[]
  batteryOptions: BatteryOption[]
  /** The unit actually used when it came from the user's choice; null when the automatic pick is in effect. */
  batteryUnit: string | null
}
