import type { BatterySpecs, InverterSpecs, ProductInput } from './product-schema'

export const SHEET = 'https://example.com/sheet.pdf'
export const NONE = { value: null, source: null, asWritten: null }
export const stated = <T>(value: T, asWritten: string) => ({ value, source: SHEET, asWritten })

export function inverter(specs: Partial<InverterSpecs> = {}): Extract<ProductInput, { kind: 'inverter' }> {
  return {
    kind: 'inverter', brand: 'EG4 Electronics', model: '6000XP', makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      continuousW: stated(6000, 'NOMINAL POWER OUTPUT 6000W'),
      surges: [
        { w: 12000, seconds: 3.5, asWritten: '12,000W for ≈3.5 seconds', source: SHEET },
        { w: 11000, seconds: 5, asWritten: '11,000W for ≈5 seconds', source: SHEET },
      ],
      batteryVolts: stated(48, 'NOMINAL VOLTAGE 48 VDC'), splitPhase: stated(true, '120/240VAC'),
      chargerA: NONE, pvInputW: NONE, pvVocMax: NONE, maxParallelUnits: stated(16, 'MAX. UNITS IN PARALLEL 16'),
      idleW: NONE, peakEfficiencyPct: NONE, warrantyYears: stated(5, '5-YEAR WARRANTY'),
      bmsComms: ['can', 'rs485'], compatibleBatteryBrands: [],
      ...specs,
    },
  }
}

export function battery(specs: Partial<BatterySpecs> = {}): Extract<ProductInput, { kind: 'battery' }> {
  return {
    kind: 'battery', brand: 'Pytes', model: 'V5', makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      chemistry: stated('lifepo4' as const, 'LiFePO4'), nominalV: stated(51.2, 'Nominal Voltage 51.2V'), ah: stated(100, '100Ah'),
      kWh: stated(5.12, '5.12kWh'), maxContinuousA: stated(100, 'Max. continuous discharge 100A'), peakA: NONE, peakSeconds: NONE,
      maxParallel: stated(16, 'Up to 16 in parallel'), cycleLife: NONE, warrantyYears: NONE,
      bmsComms: ['can'], compatibleInverterBrands: [],
      ...specs,
    },
  }
}
