import { SIZING, type Chemistry, type Voltage } from './catalog'

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
  /** The solar flow's chart runs from 0 to at least a 1,100 W draw's day of use, rounded up to the next 2 kWh past that. */
  CHART_MIN_WH: 26_400,
  CHART_STEP_WH: 2_000,
  /** On the slider's half-hour grid. */
  DEFAULT_SUN_HOURS: 4.5,
  SUN_RANGE: [3, 6.5] as const,
  SUN_STEP: 0.5,
  ROOF_RANGE: [5, 500] as const,
  ROOF_STEP: 5,
  MAX_PER_STRING: 5,
  /** Strings one controller takes in parallel: two need no fuse of their own, and the kit lists none. */
  MAX_PARALLEL_STRINGS: 2,
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
  /** How much of the bank is usable and how much of what the panels put in it keeps. */
  chemistry: Pick<Chemistry, 'dod' | 'chargeEff'>
  volts: Voltage
  /** Duty-weighted average draw of the selected load; a day's use is 24 h of it. */
  averageW: number
}

export interface SolarPick {
  roofM2: number
  sunHours: number
  volts: Voltage
  fit: number
  /** The most panels at or under the fit that wire: one planner tile each, the count the roof line names, and what the roof limit compares. */
  wiredFit: number
  /** Panels that refill the usable energy in one clear day, before the roof and the wiring round it. */
  need: number
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
  /** A day's use at the appliances. */
  dailyUseWh: number
  /** A clear day's yield over what a day's use takes out of the bank: the use over the inverter's losses. */
  coverRatio: number
  /** The same share on a cloudy day, which yields `CLOUDY_SHARE` of a clear one. */
  cloudyCoverRatio: number
  /** What a clear day yields past refilling the bank from empty; zero when it does not refill it. */
  spareWh: number
  /** The clear-day chart: its upper limit, and the fill (use a clear day carries) and the day's-use mark as shares of it, 0 to 1. */
  chart: SolarChart
  /** What the panels put in to refill the bank from empty: its usable energy over the charge losses. */
  refillWh: number
  /** Hours of peak sun to refill the bank from empty; null with no panels. */
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

export interface SolarChart { maxWh: number; carriedShare: number; useShare: number }

const HOURS_PER_DAY = 24
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** How many panels a roof holds with walkways. */
export function panelsFit(roofM2: number): number {
  return Math.max(0, Math.floor(roofM2 / SOLAR.M2_PER_PANEL))
}

/** Watt-hours one panel puts into the bank on a clear day. */
const perPanelDayWh = (sunHours: number) => SOLAR.PANEL_W * sunHours * SOLAR.SYSTEM_EFF

/** The fewest panels that put `refillWh` into the bank in one clear day. */
export function panelsToRefill(refillWh: number, sunHours: number): number {
  if (refillWh <= 0 || sunHours <= 0) return 0
  return Math.ceil(refillWh / perPanelDayWh(sunHours))
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

interface StringLayout { strings: number; perString: number; controllers: number; controllerA: number; stringsOnFullest: number }

/**
 * Equal strings for exactly `panels`, every string from the shortest that charges up to five long (fewer where one
 * controller passes less, as at 12 V), at most two to a controller. The fewest controllers win, then the smallest
 * controller rating, then the fewest strings. Null when no length divides the count, or when every one that does needs
 * more controllers than the panels need at the most one controller carries (166 at 48 V as 83 strings of 2).
 */
function stringLayout(panels: number, volts: Voltage): StringLayout | null {
  const perController = panelsPerController(volts)
  const chargeV = SOLAR.CHARGE_V[volts]
  let best: StringLayout | null = null
  let mostOnOne = 0
  for (let perString = Math.min(SOLAR.MAX_PER_STRING, perController); perString >= minSeries(volts); perString--) {
    const stringsOnOne = Math.min(SOLAR.MAX_PARALLEL_STRINGS, Math.floor(perController / perString))
    mostOnOne = Math.max(mostOnOne, stringsOnOne * perString)
    if (panels % perString !== 0) continue
    const strings = panels / perString
    const controllers = Math.ceil(strings / stringsOnOne)
    const stringsOnFullest = Math.ceil(strings / controllers)
    const controllerA = pickRating(SOLAR.CONTROLLER_AMPS, (stringsOnFullest * perString * SOLAR.PANEL_W) / chargeV)
    const isBetter = !best || controllers < best.controllers || (controllers === best.controllers && controllerA < best.controllerA)
    if (isBetter) best = { strings, perString, controllers, controllerA, stringsOnFullest }
  }
  return best && best.controllers === Math.ceil(panels / mostOnOne) ? best : null
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

/** The first count past `n` that wires, going up (`dir` 1) or down (-1); zero when none does. Taps ask for it, so adding always adds and removing always removes. */
export function nextWirable(n: number, dir: 1 | -1, volts: Voltage): number {
  for (let count = n + dir; count > 0 && count <= panelsFit(SOLAR.ROOF_RANGE[1]); count += dir) if (stringLayout(count, volts)) return count
  return 0
}

/** Controllers, equal strings and the PV breaker for a count that wires; the ratings come from the fullest controller. */
function sizeElectrical(panels: number, volts: Voltage) {
  const layout = panels === 0 ? null : stringLayout(panels, volts)
  if (!layout) return { chargeA: 0, controllers: 0, controllerA: 0, strings: 0, perString: 0, breakerA: 0 }
  const { strings, perString, controllers, controllerA, stringsOnFullest } = layout
  return {
    chargeA: Math.round((panels * SOLAR.PANEL_W) / SOLAR.CHARGE_V[volts]),
    controllers,
    controllerA,
    strings,
    perString,
    breakerA: pickRating(SOLAR.BREAKERS, SOLAR.PANEL_ISC * stringsOnFullest * SOLAR.BREAKER_MARGIN),
  }
}

/** The chart reaches past both the yield and the use, so neither marker sits off its end. */
function solarChart(dailyWh: number, dailyUseWh: number, coverRatio: number): SolarChart {
  const maxWh = Math.max(SOLAR.CHART_MIN_WH, Math.ceil(Math.max(dailyWh, dailyUseWh) / SOLAR.CHART_STEP_WH) * SOLAR.CHART_STEP_WH)
  // The fill is the use a clear day's yield carries past the inverter, so it meets the day's-use mark at exactly full cover.
  const share = (wh: number) => Math.min(1, wh / maxWh)
  return { maxWh, carriedShare: share(dailyUseWh * coverRatio), useShare: share(dailyUseWh) }
}

/** The solar side of the kit, or null when the project has no panels. Every input is clamped, never trusted. */
export function sizeSolar(input: SolarInput): SolarPick | null {
  if (!input.solar) return null
  const roofM2 = clamp(finite(input.solar.roofM2, SOLAR.ROOF_RANGE[0]), SOLAR.ROOF_RANGE[0], SOLAR.ROOF_RANGE[1])
  const sunHours = clamp(finite(input.solar.sunHours, SOLAR.DEFAULT_SUN_HOURS), SOLAR.SUN_RANGE[0], SOLAR.SUN_RANGE[1])
  const bankWh = Math.max(0, finite(input.bankWh, 0))
  const refillWh = (bankWh * input.chemistry.dod) / input.chemistry.chargeEff
  const fit = panelsFit(roofM2)
  const wiredFit = nextWirable(fit + 1, -1, input.volts)
  const need = panelsToRefill(refillWh, sunHours)
  // The recommendation rounds up from the shortest string that charges to a count that wires, within the roof; a tap rounds to the nearest.
  const wanted = Math.min(fit, need > 0 ? Math.max(need, minSeries(input.volts)) : 0)
  const recommended = nextWirable(Math.min(wanted, wiredFit) - 1, 1, input.volts)
  const tapped = input.solar.panels
  const asked = tapped === null ? wanted : clamp(Math.trunc(finite(tapped, wanted)), 0, fit)
  const panels = tapped === null ? recommended : nearestWirable(asked, fit, input.volts)

  const arrayW = panels * SOLAR.PANEL_W
  const dailyWh = Math.round(arrayW * sunHours * SOLAR.SYSTEM_EFF)
  const dailyUseWh = Math.round(Math.max(0, finite(input.averageW, 0)) * HOURS_PER_DAY)
  const refillHours = arrayW > 0 ? refillWh / (arrayW * SOLAR.SYSTEM_EFF) : null
  const refillsInOneDay = refillHours !== null && refillHours <= sunHours
  const electrical = sizeElectrical(panels, input.volts)
  const coverRatio = dailyUseWh > 0 ? dailyWh / (dailyUseWh / SIZING.INVERTER_EFF) : 0

  return {
    roofM2, sunHours, volts: input.volts, fit, wiredFit, need, recommended, panels,
    isRecommended: panels === recommended,
    isRoofLimited: wiredFit < need,
    isTooShort: asked > 0 && panels === 0,
    arrayW,
    roofUsedM2: panels * SOLAR.M2_PER_PANEL,
    dailyWh,
    cloudyWh: Math.round(dailyWh * SOLAR.CLOUDY_SHARE),
    dailyUseWh,
    coverRatio,
    cloudyCoverRatio: coverRatio * SOLAR.CLOUDY_SHARE,
    spareWh: Math.max(0, dailyWh - refillWh),
    chart: solarChart(dailyWh, dailyUseWh, coverRatio),
    refillWh,
    refillHours,
    refillsInOneDay,
    refillDays: refillHours === null ? null : refillsInOneDay ? null : refillWh / dailyWh,
    ...electrical,
    stringVoc: Math.round(electrical.perString * SOLAR.PANEL_VOC),
    pvCablePairs: electrical.strings,
    pvRunM: SOLAR.PV_RUN_M,
  }
}
