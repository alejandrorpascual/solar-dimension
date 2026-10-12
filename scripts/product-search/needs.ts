import { CATALOG_SNAPSHOT } from '../../src/lib/catalog-snapshot'
import { SIZING, type ChemistryId, type Voltage } from '../../src/lib/catalog'
import { compute, hasPanels, type SizingInput, type SizingResult } from '../../src/lib/sizing'
import { DEFAULT_QTY } from '../../src/lib/store'

/** What a found inverter and battery must meet, read from the engine's result. */
export interface ProductNeeds {
  runningW: number
  /** The engine's own minimum: running load × SIZING.HEADROOM. */
  inverterW: number
  surgeW: number
  surgeSeconds: number
  volts: Voltage
  chemistry: ChemistryId
  /** Energy the bank must deliver over the window, at the battery terminals. */
  usableWh: number
  /** DC current the bank must supply at the full running load. */
  dcA: number
  splitPhase: boolean
  /** Solar array the inverter's charger must accept; null for a battery-only kit. */
  arrayW: number | null
}

/** A typical home: the app's default loads plus a 1-ton inverter AC and a washer, 10 hours at 48 V LiFePO₄. */
export const SPIKE_KIT: SizingInput = {
  qty: { ...DEFAULT_QTY, ac1i: 1, washer: 1 },
  hours: 10,
  volts: 48,
  chemistry: 'lifepo4',
}

export function productNeeds(r: SizingResult): ProductNeeds {
  return {
    runningW: r.runningW,
    inverterW: Math.ceil(r.runningW * SIZING.HEADROOM),
    surgeW: r.surgeW,
    surgeSeconds: r.surgeSeconds,
    volts: r.volts,
    chemistry: r.chemistry,
    usableWh: Math.ceil(r.loadWh / SIZING.INVERTER_EFF),
    dcA: Math.ceil(r.runningW / SIZING.INVERTER_EFF / r.volts),
    splitPhase: r.warnings.some((w) => w.code === 'splitPhase'),
    arrayW: hasPanels(r) ? r.solar.arrayW : null,
  }
}

export function spikeNeeds(input: SizingInput = SPIKE_KIT): { result: SizingResult; needs: ProductNeeds } {
  const result = compute(input, CATALOG_SNAPSHOT)
  return { result, needs: productNeeds(result) }
}
