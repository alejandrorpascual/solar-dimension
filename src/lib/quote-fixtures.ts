import type { LineKind, LineSpecs, QuoteExtraction, QuoteLine } from './quote-schema'

const NO_SPECS: LineSpecs = {
  watts: null, surgeWatts: null, hasCharger: null, hasWifi: null, batteryVolts: null, ah: null, kWh: null, chemistry: null,
  panelWatts: null, chargerAmps: null, awg: null, mm2: null, fuseAmps: null, fuseClass: null,
}

type LineOverrides = Partial<Omit<QuoteLine, 'specs'>> & { specs?: Partial<LineSpecs> }

/** One quote line with every spec null unless given. */
export function line(kind: LineKind, lineTotal: number, over: LineOverrides = {}): QuoteLine {
  const { specs, ...rest } = over
  return {
    kind, description: kind, brand: null, model: null, qty: 1, unitPrice: null, lineTotal, optional: false, option: null,
    source: { page: 1, text: kind }, ...rest, specs: { ...NO_SPECS, ...specs },
  }
}

/** A quote whose total is the sum of its non-optional lines, unless given. */
export function extraction(lines: QuoteLine[], over: Partial<QuoteExtraction> = {}): QuoteExtraction {
  const total = lines.filter((l) => !l.optional).reduce((a, l) => a + l.lineTotal, 0)
  return {
    vendor: { name: null, contact: null }, date: null, validUntil: null, currency: 'USD', options: [], lines,
    subtotal: null, tax: null, total, warranties: [], notes: [], ...over,
  }
}

/**
 * The kit the unit tests judge quotes against: 3.9 kW running, 9.4 kW at start-up, 8 kWh of battery, 2/0 cable and a
 * 200 A fuse. Typed structurally, so it is a `KitNeeds` (quote-items.ts) without importing the type.
 */
export const SAMPLE_KIT = {
  runningW: 3860, surgeW: 9400, usableWh: 8000, chemistry: 'lifepo4', cableMm2: 67.4, cableGauge: '2/0 AWG', fuseA: 200,
} as const

const said = (page: number, text: string) => ({ description: text, source: { page, text } })

const battery = (qty: number, lineTotal: number, kWh = 5.12) =>
  line('battery', lineTotal, { qty, ...said(1, `Batería LiFePO4 ${kWh} kWh × ${qty}`), specs: { kWh, chemistry: 'lifepo4' } })

export const SAMPLE_QUOTES = {
  solartec: extraction(
    [
      line('inverter', 1890, { ...said(1, 'Inversor híbrido 12 kW 48 V con cargador 120 A'), specs: { watts: 12000, surgeWatts: 24000, hasCharger: true, chargerAmps: 120 } }),
      battery(8, 2760),
      line('monitoring', 85, said(1, 'Módulo WiFi de monitoreo')),
      line('wiring', 160, { ...said(1, 'Cable 4/0 AWG, 2 tramos'), specs: { awg: '4/0' } }),
      line('fuse', 90, { ...said(1, 'Fusible clase T 450 A'), specs: { fuseAmps: 450, fuseClass: 'T' } }),
      line('labor', 1495, said(2, 'Instalación y puesta en marcha')),
    ],
    { vendor: { name: 'SolarTec Caribe', contact: null }, warranties: [{ kind: 'battery', years: 10 }, { kind: 'inverter', years: 5 }] },
  ),
  voltia: extraction(
    [
      line('inverter', 2150, { ...said(1, 'Inversor híbrido 12 kW'), specs: { watts: 12000, surgeWatts: 24000, hasCharger: true, chargerAmps: 100 } }),
      battery(12, 3300),
      line('monitoring', 90, said(2, 'Monitoreo por app (WiFi)')),
      line('wiring', 180, { ...said(2, 'Cable 4/0 AWG'), specs: { awg: '4/0' } }),
      line('fuse', 95, { ...said(2, 'Fusible clase T 450 A'), specs: { fuseAmps: 450 } }),
      line('labor', 1485, said(2, 'Instalación, 2 días')),
    ],
    { vendor: { name: 'Voltia Instalaciones', contact: null }, warranties: [{ kind: 'battery', years: 10 }, { kind: 'inverter', years: 5 }] },
  ),
  grupoluz: extraction(
    [
      line('inverter', 2000, { ...said(1, 'Inversor 12 kW'), specs: { watts: 12000, surgeWatts: 24000 } }),
      battery(8, 2700),
      line('wiring', 150, { ...said(1, 'Cableado 4/0'), specs: { awg: '4/0' } }),
      line('labor', 1300, said(1, 'Mano de obra')),
    ],
    { vendor: { name: 'Grupo Luz', contact: null }, warranties: [{ kind: 'battery', years: 5 }, { kind: 'inverter', years: 2 }] },
  ),
  enerhogar: extraction(
    [
      line('inverter', 1450, { ...said(1, 'Inversor 300 W'), specs: { watts: 300, surgeWatts: 600 } }),
      battery(1, 2700, 1.28),
      line('charger', 250, { ...said(1, 'Cargador 60 A'), specs: { chargerAmps: 60 } }),
      line('monitoring', 120, { ...said(1, 'WiFi opcional +$120'), optional: true }),
      line('wiring', 150, { ...said(1, 'Cable 8 AWG'), specs: { awg: '8' } }),
      line('labor', 1400, said(1, 'Instalación')),
    ],
    { vendor: { name: 'EnerHogar', contact: null }, warranties: [{ kind: 'battery', years: 5 }, { kind: 'inverter', years: 2 }] },
  ),
  /**
   * The user's SUNA M.P. quote: two alternative kits, each priced on its own, and a blank total. Each kit's batteries
   * and controller are written into the inverter's line, so they are split into their own lines at 0.
   */
  suna: extraction(
    [
      ...[
        line('inverter', 2600, { option: 'o1', specs: { watts: 3000 } }),
        line('battery', 0, { option: 'o1', qty: 2, specs: { kWh: 5.12, chemistry: 'lifepo4' } }),
      ].map((l) => ({ ...l, ...said(1, 'Inversor de corriente 3 kW, incluye 2 baterías de litio 5.12 kWh, transfer y flete') })),
      ...[
        line('inverter', 6200, { option: 'o2', specs: { watts: 10000 } }),
        line('battery', 0, { option: 'o2', specs: { ah: 200, chemistry: 'lifepo4' } }),
        line('charge_controller', 0, { option: 'o2', specs: { chargerAmps: 80 } }),
      ].map((l) => ({ ...l, ...said(1, 'Inversor de corriente 10 kW, incluye baterías de litio 200 Ah, controlador solar 80 A/48 V') })),
    ],
    {
      vendor: { name: 'SUNA M.P.', contact: null }, total: 0,
      options: [{ id: 'o1', label: 'Inversor 3 kW', total: null }, { id: 'o2', label: 'Inversor 10 kW', total: null }],
    },
  ),
} satisfies Record<string, QuoteExtraction>

export type SampleQuoteId = keyof typeof SAMPLE_QUOTES
