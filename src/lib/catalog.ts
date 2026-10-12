export type Category =
  | 'Kitchen' | 'Living' | 'Climate' | 'Air conditioning' | 'Work' | 'Utility' | 'Security' | 'Personal' | 'Custom'
export type Voltage = 12 | 24 | 36 | 48
export type ChemistryId = 'lifepo4' | 'agm'
export type CompressorType = 'inverter' | 'conventional'
/** Conductor insulation rating the NEC ampacity column is read from. */
export type InsulationC = 75 | 90
export type BmsComms = 'none' | 'rs485' | 'can'
export type FuseClass = 'T' | 'ANL' | 'MRBF'
/** How an appliance draws over the window: always on, cycling on and off, or short bursts (a gate motor). */
export type LoadKind = 'continuous' | 'cycling' | 'momentary'
/** How long the start-up surge lasts: an electronic inrush, a motor, or a compressor against pressure. */
export type SurgeClass = 'inrush' | 'motor' | 'compressor'

export const LOAD_KINDS: readonly LoadKind[] = ['continuous', 'cycling', 'momentary']
export const SURGE_CLASSES: readonly SurgeClass[] = ['inrush', 'motor', 'compressor']

export interface ApplianceLabel { name: string; note: string }
export interface ApplianceLabels { en: ApplianceLabel; es: ApplianceLabel }

export interface CatalogItem {
  id: string
  name: string
  cat: Category
  watts: number
  surge: number
  duty: number
  note: string
  tons?: number
  acType?: CompressorType
  isCustom?: boolean
  /** Per-locale name and note; catalog items have them, custom loads do not. */
  labels?: ApplianceLabels
  /** Hidden from the picker; still counted in projects that use it. */
  retired?: boolean
  /** Absent means derived: duty 1 is continuous, anything else cycles. */
  kind?: LoadKind
  /** Absent means derived from the surge ratio and the compressor type. */
  surgeClass?: SurgeClass
  /** Momentary loads only: seconds per burst and bursts per hour; the duty they imply is burst × cycles / 3600. */
  burstSeconds?: number
  cyclesPerHour?: number
}

export const SIZING = {
  INVERTER_EFF: 0.9,
  HEADROOM: 1.25,
  MAX_DROP_PCT: 3,
  LINK_LENGTH_M: 0.3,
  MAX_PRACTICAL_AMPS: 300,
  /** Fallback parallel limit for a unit that states none. */
  MAX_PARALLEL_STRINGS: 4,
  DOMINANT_SHARE: 0.5,
  WATTS_PER_TON: 1100,
  MAX_QTY: 100,
  SPLIT_PHASE_W: 3000,
  /** NEC 210.19 / 706.30: conductors and overcurrent devices carry 125% of a continuous load. */
  NEC_CONTINUOUS: 1.25,
  /** NEC 110.14(C): terminations are rated 75 °C, so a 90 °C conductor's ampacity is capped at the 75 °C column. */
  TERMINATION_C: 75 as InsulationC,
  AMBIENT_DEFAULT_C: 30,
  MAX_RUNS: 6,
  /** Voltage drop at start-up current the inverter still rides through. */
  MAX_STARTUP_DROP_PCT: 10,
  DUTY_MIN: 0.05,
  /** Runtime scenarios: how cycling duties and inverter efficiency move on a light day and on a hard one. */
  SCENARIO: { optimistic: { duty: 0.8, eff: 0.93 }, worst: { duty: 1.3, eff: 0.85 } },
  /** Seconds a start-up surge lasts, by class. */
  SURGE_SECONDS: { inrush: 0.02, motor: 1, compressor: 3 } as Record<SurgeClass, number>,
  /** How many times its rating a fuse holds, and for how long, before a start-up blows it. */
  FUSE_SURGE_HOLD: { T: { factor: 2, seconds: 5 }, ANL: { factor: 2, seconds: 10 }, MRBF: { factor: 2, seconds: 5 } } as Record<FuseClass, { factor: number; seconds: number }>,
  /** Battery bank voltage rises on charge; a DC fuse must be rated above that. */
  FUSE_VOLTAGE_MARGIN: 1.25,
  DEFAULT_SIMULTANEOUS_STARTS: 1,
} as const

export const CATEGORIES: readonly Category[] = [
  'Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal', 'Custom',
]

export const VOLTAGES: readonly Voltage[] = [12, 24, 36, 48]
export const VOLTAGE_HINTS: Record<Voltage, string> = {
  12: 'Small systems up to ~2 kW',
  24: 'Mid-size, up to ~5 kW',
  36: 'Uncommon; golf-cart banks',
  48: 'Whole-home, 3 kW and up',
}

/** One battery as sold, with the discharge its BMS (or, for lead-acid, its maker) allows. */
export interface BatteryUnit {
  v: number
  ah: number
  maxContinuousA: number
  peakA: number
  peakSeconds: number
  /** How many of this unit the maker allows in parallel. */
  maxParallel: number
  bmsComms: BmsComms
  /** Prospective short-circuit current of one unit; absent means ah × the chemistry's shortCircuitPerAh. */
  shortCircuitA?: number
}
export interface Chemistry {
  id: ChemistryId
  label: string
  short: string
  dod: number
  /** Peukert exponent (1 = capacity does not shrink with current) and the hour rate the Ah is quoted at. */
  peukertK: number
  ratedHours: number
  /** Amps per Ah a shorted unit can deliver, for the fuse's interrupting rating. */
  shortCircuitPerAh: number
  units: readonly BatteryUnit[]
}

const PEAK_SECONDS = 5
const lfp = (v: number, ah: number, maxContinuousA: number, maxParallel: number, bmsComms: BmsComms = 'none'): BatteryUnit =>
  ({ v, ah, maxContinuousA, peakA: maxContinuousA * 2, peakSeconds: PEAK_SECONDS, maxParallel, bmsComms })
/** AGM: 0.3C continuous, 1C for a few seconds. */
const agm = (v: number, ah: number): BatteryUnit =>
  ({ v, ah, maxContinuousA: Math.round(ah * 0.3), peakA: ah, peakSeconds: PEAK_SECONDS, maxParallel: 4, bmsComms: 'none' })

export const CHEMISTRIES: Record<ChemistryId, Chemistry> = {
  lifepo4: {
    id: 'lifepo4', label: 'LiFePO₄ lithium', short: 'LiFePO₄', dod: 0.85, peukertK: 1, ratedHours: 20, shortCircuitPerAh: 25,
    units: [
      lfp(12, 100, 100, 4), lfp(12, 200, 200, 4), lfp(12, 300, 200, 4), lfp(12, 400, 250, 4),
      lfp(24, 100, 100, 4), lfp(24, 200, 200, 4),
      lfp(48, 50, 50, 8, 'rs485'),
      lfp(48, 100, 100, 16, 'can'), lfp(48, 200, 200, 16, 'can'), lfp(48, 280, 200, 16, 'can'), lfp(48, 300, 200, 16, 'can'), lfp(48, 314, 200, 16, 'can'),
    ],
  },
  agm: {
    id: 'agm', label: 'AGM lead-acid', short: 'AGM', dod: 0.5, peukertK: 1.15, ratedHours: 20, shortCircuitPerAh: 12,
    units: [agm(6, 225), agm(12, 100), agm(12, 200)],
  },
}

export interface Inverter {
  w: number
  surge: number
  volts: readonly Voltage[]
  /** How long `surge` is rated for. */
  surgeSeconds: number
  /** A lower surge the unit holds for longer, when the maker states one. */
  surgeLong?: { w: number; seconds: number }
  /** How many identical units the maker allows to work in parallel as one; absent means the unit works alone. */
  maxParallel?: number
}

const SURGE_FACTOR = 2
const LONG_SURGE_FACTOR = 1.5
const LONG_SURGE_SECONDS = 30
const surgeSecondsFor = (w: number): number => (w <= 2000 ? 3 : w <= 5000 ? 5 : 10)
/**
 * Parallel operation in the stock list: the fewest units any maker surveyed allows on one phase (SMA Sunny Island
 * 6.0H/8.0H: three; Schneider XW Pro four, Victron MultiPlus and Growatt SPF six, Sol-Ark, OutBack, EG4 and Deye ten
 * or more), from the smallest size those makers build for it (Victron MultiPlus 3000 VA at 12, 24 and 48 V).
 */
const PARALLEL_MIN_W = 3000
const MAX_PARALLEL_UNITS = 3
const inverter = (w: number, volts: readonly Voltage[]): Inverter => ({
  w, surge: w * SURGE_FACTOR, volts, surgeSeconds: surgeSecondsFor(w),
  ...(w >= 3000 ? { surgeLong: { w: Math.round(w * LONG_SURGE_FACTOR), seconds: LONG_SURGE_SECONDS } } : {}),
  ...(w >= PARALLEL_MIN_W ? { maxParallel: MAX_PARALLEL_UNITS } : {}),
})

export const INVERTERS: readonly Inverter[] = [
  inverter(1000, [12]),
  inverter(1500, [12]),
  inverter(2000, [12, 24]),
  inverter(3000, [12, 24, 48]),
  inverter(4000, [24, 36, 48]),
  inverter(5000, [24, 36, 48]),
  inverter(6000, [48]),
  inverter(8000, [48]),
  inverter(10000, [48]),
  inverter(12000, [48]),
]

/** Copper conductors: NEC 310.16 ampacity at 75 °C and 90 °C (30 °C ambient, up to 3 in a raceway) and DC resistance. */
export interface Gauge { awg: string; mm2: number; amps75: number; amps90: number; ohmPerM: number }
export const GAUGES: readonly Gauge[] = [
  { awg: '8 AWG', mm2: 8.4, amps75: 50, amps90: 55, ohmPerM: 0.0021 },
  { awg: '6 AWG', mm2: 13.3, amps75: 65, amps90: 75, ohmPerM: 0.00132 },
  { awg: '4 AWG', mm2: 21.2, amps75: 85, amps90: 95, ohmPerM: 0.00083 },
  { awg: '2 AWG', mm2: 33.6, amps75: 115, amps90: 130, ohmPerM: 0.00052 },
  { awg: '1 AWG', mm2: 42.4, amps75: 130, amps90: 145, ohmPerM: 0.00041 },
  { awg: '1/0 AWG', mm2: 53.5, amps75: 150, amps90: 170, ohmPerM: 0.00033 },
  { awg: '2/0 AWG', mm2: 67.4, amps75: 175, amps90: 195, ohmPerM: 0.00026 },
  { awg: '3/0 AWG', mm2: 85.0, amps75: 200, amps90: 225, ohmPerM: 0.00021 },
  { awg: '4/0 AWG', mm2: 107.2, amps75: 230, amps90: 260, ohmPerM: 0.00016 },
]

/** A DC fuse as sold: rating, class, interrupting capacity and the highest DC voltage it is listed for. */
export interface Fuse { a: number; class: FuseClass; aicA: number; maxVdc: number }
const CLASS_T_AIC_A = 20000
const CLASS_T_MAX_VDC = 125
export const FUSES: readonly Fuse[] = [60, 80, 100, 125, 150, 175, 200, 225, 250, 300, 350, 400]
  .map((a) => ({ a, class: 'T' as const, aicA: CLASS_T_AIC_A, maxVdc: CLASS_T_MAX_VDC }))

/** Everything the engine sizes with that is not an appliance. Passed to compute() so a managed catalog can replace it later. */
export interface HardwareCatalog {
  chemistries: Record<ChemistryId, Chemistry>
  inverters: readonly Inverter[]
  gauges: readonly Gauge[]
  fuses: readonly Fuse[]
}
export const DEFAULT_HARDWARE: HardwareCatalog = { chemistries: CHEMISTRIES, inverters: INVERTERS, gauges: GAUGES, fuses: FUSES }

/** What the appliance picker offers: the catalog without retired items. The engine still counts retired ones. */
export const forPicker = (items: readonly CatalogItem[]): CatalogItem[] => items.filter((i) => !i.retired)

/** Whether an appliance needs a 240 V split-phase inverter (3 kW or more). */
export const needsSplitPhase = (item: { watts: number }): boolean => item.watts >= SIZING.SPLIT_PHASE_W
