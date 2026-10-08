import type { Voltage } from './catalog'

/** Panel, roof and electrical assumptions the solar side of the kit is built on. Shown in the fine print. */
export const SOLAR = {
  PANEL_W: 550,
  PANEL_VOC: 49.6,
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

/** Controllers needed for the array's charge current; each one is later given at least one string. */
function sizeControllers(arrayW: number, volts: Voltage) {
  if (arrayW === 0) return { chargeA: 0, controllers: 0, controllerA: 0 }
  const chargeA = Math.round(arrayW / SOLAR.CHARGE_V[volts])
  const maxA = SOLAR.CONTROLLER_AMPS[SOLAR.CONTROLLER_AMPS.length - 1]!
  const controllers = Math.max(1, Math.ceil(chargeA / maxA))
  const controllerA = pickRating(SOLAR.CONTROLLER_AMPS, chargeA / controllers)
  return { chargeA, controllers, controllerA }
}

/** Strings cut at the per-string cap, but never fewer than one per controller. */
function sizeStrings(panels: number, controllers: number) {
  if (panels === 0) return { strings: 0, perString: 0 }
  const strings = Math.max(Math.ceil(panels / SOLAR.MAX_PER_STRING), controllers)
  return { strings, perString: Math.ceil(panels / strings) }
}

const sizeBreaker = (strings: number, controllers: number) =>
  controllers === 0
    ? 0
    : pickRating(SOLAR.BREAKERS, SOLAR.PANEL_ISC * Math.ceil(strings / controllers) * SOLAR.BREAKER_MARGIN)

/** The solar side of the kit, or null when the project has no panels. Every input is clamped, never trusted. */
export function sizeSolar(input: SolarInput): SolarPick | null {
  if (!input.solar) return null
  const roofM2 = clamp(finite(input.solar.roofM2, SOLAR.ROOF_RANGE[0]), SOLAR.ROOF_RANGE[0], SOLAR.ROOF_RANGE[1])
  const sunHours = clamp(finite(input.solar.sunHours, SOLAR.DEFAULT_SUN_HOURS), SOLAR.SUN_RANGE[0], SOLAR.SUN_RANGE[1])
  const bankWh = Math.max(0, finite(input.bankWh, 0))
  const fit = panelsFit(roofM2)
  const need = panelsToRefill(bankWh, sunHours)
  const recommended = Math.min(fit, need)
  const tapped = input.solar.panels
  const panels = tapped === null ? recommended : clamp(Math.trunc(finite(tapped, recommended)), 0, fit)

  const arrayW = panels * SOLAR.PANEL_W
  const dailyWh = Math.round(arrayW * sunHours * SOLAR.SYSTEM_EFF)
  const dailyUseWh = Math.round(Math.max(0, finite(input.averageW, 0)) * HOURS_PER_DAY)
  const refillHours = arrayW > 0 ? bankWh / (arrayW * SOLAR.SYSTEM_EFF) : null
  const refillsInOneDay = refillHours !== null && refillHours <= sunHours
  const electrical = sizeControllers(arrayW, input.volts)
  const { strings, perString } = sizeStrings(panels, electrical.controllers)

  return {
    roofM2, sunHours, fit, recommended, panels,
    isRecommended: panels === recommended,
    isRoofLimited: fit < need,
    arrayW,
    roofUsedM2: panels * SOLAR.M2_PER_PANEL,
    dailyWh,
    cloudyWh: Math.round(dailyWh * SOLAR.CLOUDY_SHARE),
    dailyUseWh,
    coverRatio: dailyUseWh > 0 ? dailyWh / dailyUseWh : 0,
    refillHours,
    refillsInOneDay,
    refillDays: refillHours === null ? null : refillsInOneDay ? null : bankWh / dailyWh,
    strings, perString,
    stringVoc: Math.round(perString * SOLAR.PANEL_VOC),
    ...electrical,
    breakerA: sizeBreaker(strings, electrical.controllers),
    pvCablePairs: strings,
    pvRunM: SOLAR.PV_RUN_M,
  }
}
