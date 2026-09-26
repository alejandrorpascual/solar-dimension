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

const BASE: readonly CatalogItem[] = [
  { id: 'fridge', name: 'Refrigerator', cat: 'Kitchen', watts: 150, surge: 1200, duty: 0.35, note: 'Compressor cycles ~35% of each hour' },
  { id: 'freezer', name: 'Chest freezer', cat: 'Kitchen', watts: 100, surge: 900, duty: 0.3, note: 'Cycles ~30% of each hour' },
  { id: 'micro', name: 'Microwave (1000 W)', cat: 'Kitchen', watts: 1200, surge: 1500, duty: 0.08, note: '~5 min per hour of use' },
  { id: 'coffee', name: 'Coffee maker', cat: 'Kitchen', watts: 900, surge: 900, duty: 0.08, note: 'Brews ~5 min per hour' },
  { id: 'kettle', name: 'Electric kettle', cat: 'Kitchen', watts: 1500, surge: 1500, duty: 0.05, note: '~3 min per hour' },
  { id: 'toaster', name: 'Toaster', cat: 'Kitchen', watts: 1000, surge: 1000, duty: 0.04, note: '~2 min per hour' },
  { id: 'lights', name: 'LED lighting (10 bulbs)', cat: 'Living', watts: 90, surge: 90, duty: 1, note: 'Continuous' },
  { id: 'tv', name: 'TV, 55-inch LED', cat: 'Living', watts: 120, surge: 120, duty: 1, note: 'Continuous' },
  { id: 'console', name: 'Game console', cat: 'Living', watts: 150, surge: 150, duty: 1, note: 'Continuous' },
  { id: 'fan', name: 'Ceiling fan', cat: 'Climate', watts: 75, surge: 150, duty: 1, note: 'Continuous' },
  { id: 'heater', name: 'Space heater', cat: 'Climate', watts: 1500, surge: 1500, duty: 0.5, note: 'Thermostat cycles ~50%' },
  { id: 'router', name: 'Wi-Fi router + modem', cat: 'Work', watts: 20, surge: 20, duty: 1, note: 'Continuous' },
  { id: 'laptop', name: 'Laptop', cat: 'Work', watts: 65, surge: 65, duty: 1, note: 'Continuous' },
  { id: 'desktop', name: 'Desktop PC + monitor', cat: 'Work', watts: 300, surge: 400, duty: 1, note: 'Continuous' },
  { id: 'phone', name: 'Phone charger', cat: 'Work', watts: 10, surge: 10, duty: 1, note: 'Continuous' },
  { id: 'washer', name: 'Washing machine', cat: 'Utility', watts: 500, surge: 1500, duty: 0.3, note: 'Motor start surge' },
  { id: 'well', name: 'Well pump, 1/2 HP', cat: 'Utility', watts: 1000, surge: 3000, duty: 0.1, note: 'Runs ~6 min per hour' },
  { id: 'sump', name: 'Sump pump, 1/3 HP', cat: 'Utility', watts: 800, surge: 2000, duty: 0.1, note: 'Runs ~6 min per hour' },
  { id: 'wheater', name: 'Electric water heater', cat: 'Utility', watts: 4500, surge: 4500, duty: 0.25, note: 'Heavy: cycles ~25%' },
  { id: 'cctv', name: 'CCTV camera', cat: 'Security', watts: 7, surge: 7, duty: 1, note: 'Continuous · includes IR night vision and PoE losses' },
  { id: 'nvr16', name: 'Recorder (NVR/DVR), up to 16 cameras', cat: 'Security', watts: 20, surge: 20, duty: 1, note: 'Continuous · 1 hard drive' },
  { id: 'nvr32', name: 'Recorder (NVR/DVR), 32+ cameras', cat: 'Security', watts: 50, surge: 50, duty: 1, note: 'Continuous · 4 hard drives' },
  { id: 'cpap', name: 'CPAP machine', cat: 'Personal', watts: 40, surge: 40, duty: 1, note: 'Continuous' },
  { id: 'dryer', name: 'Hair dryer', cat: 'Personal', watts: 1500, surge: 1500, duty: 0.05, note: '~3 min per hour' },
]

const AC_TONS = [1, 1.5, 2, 3, 4, 5] as const
const COMPRESSORS: Record<CompressorType, { short: string; surgeFactor: number; duty: number; note: string }> = {
  inverter: { short: 'inverter', surgeFactor: 1.3, duty: 0.6, note: 'Inverter compressor · soft start' },
  conventional: { short: 'conventional', surgeFactor: 3.0, duty: 0.5, note: 'Conventional compressor · ~3× start surge' },
}

function airConditioners(): CatalogItem[] {
  return AC_TONS.flatMap((tons) =>
    (Object.keys(COMPRESSORS) as CompressorType[]).map((acType) => {
      const c = COMPRESSORS[acType]
      const watts = Math.round(tons * SIZING.WATTS_PER_TON)
      return {
        id: `ac${String(tons).replace('.', '')}${acType.charAt(0)}`,
        name: `${tons} ton AC · ${c.short}`,
        cat: 'Air conditioning' as const,
        watts,
        surge: Math.round(watts * c.surgeFactor),
        duty: c.duty,
        note: `${tons * 12}k BTU · ${c.note}`,
        tons,
        acType,
      }
    }),
  )
}

const insertAt = BASE.findIndex((a) => a.id === 'heater') + 1
export const APPLIANCES: readonly CatalogItem[] = [
  ...BASE.slice(0, insertAt),
  ...airConditioners(),
  ...BASE.slice(insertAt),
]
