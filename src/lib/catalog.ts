export type Category =
  | 'Kitchen' | 'Living' | 'Climate' | 'Air conditioning' | 'Work' | 'Utility' | 'Security' | 'Personal' | 'Custom'
export type Voltage = 12 | 24 | 36 | 48
export type ChemistryId = 'lifepo4' | 'agm'
export type CompressorType = 'inverter' | 'conventional'

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
}

export const SIZING = {
  INVERTER_EFF: 0.9,
  HEADROOM: 1.25,
  MAX_DROP_PCT: 3,
  LINK_LENGTH_M: 0.3,
  MAX_PRACTICAL_AMPS: 300,
  MAX_PARALLEL_STRINGS: 4,
  DOMINANT_SHARE: 0.5,
  WATTS_PER_TON: 1100,
  MAX_QTY: 100,
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

export interface BatteryUnit { v: number; ah: number }
export interface Chemistry { id: ChemistryId; label: string; short: string; dod: number; units: readonly BatteryUnit[] }
export const CHEMISTRIES: Record<ChemistryId, Chemistry> = {
  lifepo4: {
    id: 'lifepo4', label: 'LiFePO₄ lithium', short: 'LiFePO₄', dod: 0.85,
    units: [
      { v: 12, ah: 100 }, { v: 12, ah: 200 }, { v: 12, ah: 300 }, { v: 12, ah: 400 },
      { v: 24, ah: 100 }, { v: 24, ah: 200 },
      { v: 48, ah: 50 }, { v: 48, ah: 100 }, { v: 48, ah: 200 }, { v: 48, ah: 280 }, { v: 48, ah: 300 }, { v: 48, ah: 314 },
    ],
  },
  agm: {
    id: 'agm', label: 'AGM lead-acid', short: 'AGM', dod: 0.5,
    units: [{ v: 6, ah: 225 }, { v: 12, ah: 100 }, { v: 12, ah: 200 }],
  },
}

export interface Inverter { w: number; surge: number; volts: readonly Voltage[] }
export const INVERTERS: readonly Inverter[] = [
  { w: 1000, surge: 2000, volts: [12] },
  { w: 1500, surge: 3000, volts: [12] },
  { w: 2000, surge: 4000, volts: [12, 24] },
  { w: 3000, surge: 6000, volts: [12, 24, 48] },
  { w: 4000, surge: 8000, volts: [24, 36, 48] },
  { w: 5000, surge: 10000, volts: [24, 36, 48] },
  { w: 6000, surge: 12000, volts: [48] },
  { w: 8000, surge: 16000, volts: [48] },
  { w: 10000, surge: 20000, volts: [48] },
  { w: 12000, surge: 24000, volts: [48] },
]

/** Copper battery cable, 105 °C insulation ampacity. Verify against local code. */
export interface Gauge { awg: string; mm2: number; amps: number; ohmPerM: number }
export const GAUGES: readonly Gauge[] = [
  { awg: '8 AWG', mm2: 8.4, amps: 80, ohmPerM: 0.0021 },
  { awg: '6 AWG', mm2: 13.3, amps: 105, ohmPerM: 0.00132 },
  { awg: '4 AWG', mm2: 21.2, amps: 140, ohmPerM: 0.00083 },
  { awg: '2 AWG', mm2: 33.6, amps: 190, ohmPerM: 0.00052 },
  { awg: '1 AWG', mm2: 42.4, amps: 220, ohmPerM: 0.00041 },
  { awg: '1/0 AWG', mm2: 53.5, amps: 260, ohmPerM: 0.00033 },
  { awg: '2/0 AWG', mm2: 67.4, amps: 300, ohmPerM: 0.00026 },
  { awg: '3/0 AWG', mm2: 85.0, amps: 350, ohmPerM: 0.00021 },
  { awg: '4/0 AWG', mm2: 107.2, amps: 405, ohmPerM: 0.00016 },
]
export const FUSES: readonly number[] = [60, 80, 100, 125, 150, 175, 200, 225, 250, 300, 350, 400]

/** What the appliance picker offers: the catalog without retired items. The engine still counts retired ones. */
export const forPicker = (items: readonly CatalogItem[]): CatalogItem[] => items.filter((i) => !i.retired)
