import type { Voltage } from './catalog'

/** Panel, roof and electrical assumptions the solar side of the kit is built on. Shown in the fine print. */
export const SOLAR = {
  PANEL_W: 550,
  PANEL_VOC: 49.6,
  /** Maximum-power voltage at 25 °C. */
  PANEL_VMP: 40.9,
  /** Vmp on a hot roof: cells at 70 °C lose about 0.35 % per °C over 25 °C. */
  HOT_VMP_DERATE: 0.84,
  PANEL_ISC: 14,
  PANEL_SIZE: '2.28 × 1.13 m',
  /** Roof per panel including walkways and spacing. */
  M2_PER_PANEL: 3,
  /** Panel to battery: soiling, temperature, wiring and controller losses. */
  SYSTEM_EFF: 0.75,
  CLOUDY_SHARE: 0.4,
  DEFAULT_SUN_HOURS: 4.8,
  SUN_RANGE: [3, 6.5] as const,
  SUN_STEP: 0.5,
  ROOF_RANGE: [5, 500] as const,
  ROOF_STEP: 5,
  MAX_PER_STRING: 5,
  CONTROLLER_MAX_VOC: 450,
  /** How far an MPPT controller needs the string above the charge voltage to start and keep charging. */
  MPPT_HEADROOM_V: 5,
  CONTROLLER_AMPS: [30, 40, 60, 80, 100] as const,
  /** Bulk/absorption voltage per bank voltage: what the controller pushes current at. */
  CHARGE_V: { 12: 14.4, 24: 28.8, 36: 43.2, 48: 57.6 } as const satisfies Record<Voltage, number>,
  PV_CABLE: { mm2: 6, awg: '10 AWG' },
  PV_RUN_M: 20,
  BREAKER_MARGIN: 1.25,
  BREAKERS: [16, 20, 25, 32, 40, 63] as const,
} as const

export interface SolarChoice {
  roofM2: number
  /** Tapped count; null means the recommended count. */
  panels: number | null
  sunHours: number
}

export interface SolarInput {
  solar: SolarChoice | null
  bankWh: number
  volts: Voltage
  /** Duty-weighted average draw of the selected load; a day's use is 24 h of it. */
  averageW: number
}

export interface SolarPick {
  roofM2: number
  sunHours: number
  fit: number
  recommended: number
  panels: number
  isRecommended: boolean
  isRoofLimited: boolean
  /** Panels were wanted but the roof cannot hold one string long enough to charge the bank, so there are none. */
  isTooShort: boolean
  arrayW: number
  roofUsedM2: number
  dailyWh: number
  cloudyWh: number
  dailyUseWh: number
  coverRatio: number
  /** Hours of peak sun to refill the whole bank from empty; null with no panels. */
  refillHours: number | null
  refillsInOneDay: boolean
  /** Clear days to refill the bank when it takes more than one; null with no panels. */
  refillDays: number | null
  strings: number
  perString: number
  stringVoc: number
  chargeA: number
  controllers: number
  controllerA: number
  pvCablePairs: number
  pvRunM: number
  breakerA: number
}

const HOURS_PER_DAY = 24
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** How many panels a roof holds with walkways. */
export function panelsFit(roofM2: number): number {
  return Math.max(0, Math.floor(roofM2 / SOLAR.M2_PER_PANEL))
}

/** Watt-hours one panel puts into the bank on a clear day. */
const perPanelDayWh = (sunHours: number) => SOLAR.PANEL_W * sunHours * SOLAR.SYSTEM_EFF

/** The fewest panels that refill the whole bank in one clear day. */
export function panelsToRefill(bankWh: number, sunHours: number): number {
  if (bankWh <= 0 || sunHours <= 0) return 0
  return Math.ceil(bankWh / perPanelDayWh(sunHours))
}

export function recommendedPanels(p: { bankWh: number; roofM2: number; sunHours: number }): number {
  return Math.min(panelsFit(p.roofM2), panelsToRefill(p.bankWh, p.sunHours))
}

/** Smallest listed rating at or above `need`; the largest when none is. */
const pickRating = (ratings: readonly number[], need: number) => ratings.find((r) => r >= need) ?? ratings[ratings.length - 1]!

/** Panels one controller passes at its biggest rating and the bank's charge voltage. */
const panelsPerController = (volts: Voltage) =>
  Math.max(1, Math.floor((SOLAR.CONTROLLER_AMPS[SOLAR.CONTROLLER_AMPS.length - 1]! * SOLAR.CHARGE_V[volts]) / SOLAR.PANEL_W))

/** The fewest panels in series whose hot maximum-power voltage clears the bank's charge voltage and the controller's headroom. */
export function minSeries(volts: Voltage): number {
  return Math.floor((SOLAR.CHARGE_V[volts] + SOLAR.MPPT_HEADROOM_V) / (SOLAR.PANEL_VMP * SOLAR.HOT_VMP_DERATE)) + 1
}

interface StringLayout { strings: number; perString: number; controllers: number; stringsOnFullest: number }

/**
 * Equal strings for exactly `panels`, every string from the shortest that charges up to five long (fewer where one
 * controller passes less, as at 12 V); the fewest controllers win, then the fewest strings. Null when no length divides
 * the count.
 */
function stringLayout(panels: number, volts: Voltage): StringLayout | null {
  const perController = panelsPerController(volts)
  let best: StringLayout | null = null
  for (let perString = Math.min(SOLAR.MAX_PER_STRING, perController); perString >= minSeries(volts); perString--) {
    if (panels % perString !== 0) continue
    const strings = panels / perString
    const controllers = Math.ceil(strings / Math.floor(perController / perString))
    if (!best || controllers < best.controllers) best = { strings, perString, controllers, stringsOnFullest: Math.ceil(strings / controllers) }
  }
  return best
}

/** The count nearest `n` that wires as equal strings, never above the roof's fit; a tie rounds up. Zero always wires. */
function nearestWirable(n: number, fit: number, volts: Voltage): number {
  const wires = (count: number) => count === 0 || stringLayout(count, volts) !== null
  for (let step = 0; step <= n; step++) {
    if (n + step <= fit && wires(n + step)) return n + step
    if (wires(n - step)) return n - step
  }
  return 0
}

/** Controllers, equal strings and the PV breaker for a count that wires; the ratings come from the fullest controller. */
function sizeElectrical(panels: number, volts: Voltage) {
  const layout = panels === 0 ? null : stringLayout(panels, volts)
  if (!layout) return { chargeA: 0, controllers: 0, controllerA: 0, strings: 0, perString: 0, breakerA: 0 }
  const chargeV = SOLAR.CHARGE_V[volts]
  const { strings, perString, controllers, stringsOnFullest } = layout
  return {
    chargeA: Math.round((panels * SOLAR.PANEL_W) / chargeV),
    controllers,
    controllerA: pickRating(SOLAR.CONTROLLER_AMPS, (stringsOnFullest * perString * SOLAR.PANEL_W) / chargeV),
    strings,
    perString,
    breakerA: pickRating(SOLAR.BREAKERS, SOLAR.PANEL_ISC * stringsOnFullest * SOLAR.BREAKER_MARGIN),
  }
}

/** The solar side of the kit, or null when the project has no panels. Every input is clamped, never trusted. */
export function sizeSolar(input: SolarInput): SolarPick | null {
  if (!input.solar) return null
  const roofM2 = clamp(finite(input.solar.roofM2, SOLAR.ROOF_RANGE[0]), SOLAR.ROOF_RANGE[0], SOLAR.ROOF_RANGE[1])
  const sunHours = clamp(finite(input.solar.sunHours, SOLAR.DEFAULT_SUN_HOURS), SOLAR.SUN_RANGE[0], SOLAR.SUN_RANGE[1])
  const bankWh = Math.max(0, finite(input.bankWh, 0))
  const fit = panelsFit(roofM2)
  const need = panelsToRefill(bankWh, sunHours)
  // The recommendation starts at the shortest string that charges; any count then rounds to one that wires as equal strings.
  const wanted = Math.min(fit, need > 0 ? Math.max(need, minSeries(input.volts)) : 0)
  const recommended = nearestWirable(wanted, fit, input.volts)
  const tapped = input.solar.panels
  const asked = tapped === null ? wanted : clamp(Math.trunc(finite(tapped, wanted)), 0, fit)
  const panels = nearestWirable(asked, fit, input.volts)

  const arrayW = panels * SOLAR.PANEL_W
  const dailyWh = Math.round(arrayW * sunHours * SOLAR.SYSTEM_EFF)
  const dailyUseWh = Math.round(Math.max(0, finite(input.averageW, 0)) * HOURS_PER_DAY)
  const refillHours = arrayW > 0 ? bankWh / (arrayW * SOLAR.SYSTEM_EFF) : null
  const refillsInOneDay = refillHours !== null && refillHours <= sunHours
  const electrical = sizeElectrical(panels, input.volts)

  return {
    roofM2, sunHours, fit, recommended, panels,
    isRecommended: panels === recommended,
    isRoofLimited: fit < need,
    isTooShort: asked > 0 && panels === 0,
    arrayW,
    roofUsedM2: panels * SOLAR.M2_PER_PANEL,
    dailyWh,
    cloudyWh: Math.round(dailyWh * SOLAR.CLOUDY_SHARE),
    dailyUseWh,
    coverRatio: dailyUseWh > 0 ? dailyWh / dailyUseWh : 0,
    refillHours,
    refillsInOneDay,
    refillDays: refillHours === null ? null : refillsInOneDay ? null : bankWh / dailyWh,
    ...electrical,
    stringVoc: Math.round(electrical.perString * SOLAR.PANEL_VOC),
    pvCablePairs: electrical.strings,
    pvRunM: SOLAR.PV_RUN_M,
  }
}
