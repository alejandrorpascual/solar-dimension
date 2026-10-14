import type { ItemCheck, KitNeeds } from './quote-items'

/** Zone edges as quote value over kit need. Each edge belongs to the lower zone. The gauge runs from 0 to GAUGE_MAX. */
export const SIZING_ZONES = { JUST_MAX: 1.3, ROOMY_MAX: 2, GAUGE_MAX: 2.5 } as const
/** Headroom a suggested inverter keeps over the kit's running load. */
const SUGGEST_HEADROOM = 1.15
/** Inverters usually surge to about twice their rating. */
const TYPICAL_SURGE_FACTOR = 2
const SUGGEST_STEP_W = 500
const PERCENT = 100

export type SizingZone = 'short' | 'just' | 'roomy' | 'over'
export type SizedId = 'inverter' | 'battery'
export const SIZED_IDS: readonly SizedId[] = ['inverter', 'battery']
/** One component against the kit: what the quote offers, what the kit needs, and where that lands. */
export interface Sizing { have: number; need: number; ratio: number; zone: SizingZone; pos: number }
export interface QuoteSizing { inverter: Sizing | null; battery: Sizing | null }

/** Value over need, or null when the quote states no size or the kit needs nothing. */
export function sizingRatio(have: number | undefined, need: number): number | null {
  if (have === undefined || !(need > 0)) return null
  return have / need
}

export function sizingZone(ratio: number): SizingZone {
  if (ratio < 1) return 'short'
  if (ratio <= SIZING_ZONES.JUST_MAX) return 'just'
  if (ratio <= SIZING_ZONES.ROOMY_MAX) return 'roomy'
  return 'over'
}

/** Where a ratio sits on the gauge, in percent of its width. */
export function gaugePos(ratio: number): number {
  return Math.min(PERCENT, Math.max(0, (ratio / SIZING_ZONES.GAUGE_MAX) * PERCENT))
}

const roundTenth = (n: number): number => Math.round(n * 10) / 10
const EDGES = [0, 1, SIZING_ZONES.JUST_MAX, SIZING_ZONES.ROOMY_MAX, SIZING_ZONES.GAUGE_MAX]
const ZONE_ORDER: readonly SizingZone[] = ['short', 'just', 'roomy', 'over']
/** Each zone's share of the gauge, in percent. */
export const GAUGE_ZONES: readonly { zone: SizingZone; width: number }[] = ZONE_ORDER.map((zone, i) => ({
  zone, width: roundTenth(gaugePos(EDGES[i + 1]!) - gaugePos(EDGES[i]!)),
}))
export const NEED_POS = gaugePos(1)

function sizing(c: ItemCheck | undefined, have: number | undefined, need: number): Sizing | null {
  if (c === undefined || c.status === 'missing') return null
  const ratio = sizingRatio(have, need)
  if (ratio === null || have === undefined) return null
  return { have, need, ratio, zone: sizingZone(ratio), pos: gaugePos(ratio) }
}

/**
 * The inverter's running watts and the battery's usable energy against the kit. A component that isn't stated, or
 * isn't included, is null. So is a bank whose verdict rests on a chemistry it doesn't name: its usable energy is a
 * range, which its checks show, and any one figure on the bar would claim a size the quote doesn't state.
 */
export function quoteSizing(items: readonly ItemCheck[], kit: KitNeeds): QuoteSizing {
  const inverter = items.find((c) => c.id === 'inverter')
  const battery = items.find((c) => c.id === 'battery')
  return {
    inverter: sizing(inverter, inverter?.facts.watts, kit.runningW),
    battery: sizing(battery, battery?.facts.usableWh, kit.usableWh),
  }
}

/** A smaller inverter worth asking for: the next 500 W step above the load plus headroom, and enough to start the kit. */
export function suggestedInverterW(kit: KitNeeds): number {
  const floor = Math.max(kit.runningW * SUGGEST_HEADROOM, kit.surgeW / TYPICAL_SURGE_FACTOR)
  return Math.ceil(floor / SUGGEST_STEP_W) * SUGGEST_STEP_W
}
