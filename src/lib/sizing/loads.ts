import { SIZING, type CatalogItem, type LoadKind, type SurgeClass } from '../catalog'
import type { SelectedItem, SimultaneousStarts, SurgeProfile, SurgeStarter } from './types'

const SECONDS_PER_HOUR = 3600
/** A surge this many times the running watts is a compressor against pressure; twice is a plain motor. */
const COMPRESSOR_RATIO = 3
const MOTOR_RATIO = 2

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** The load kind the catalog states, or the one its duty implies. */
export function loadKindOf(item: CatalogItem): LoadKind {
  return item.kind ?? (item.duty >= 1 ? 'continuous' : 'cycling')
}

/** How long the start-up lasts: stated, or read from the compressor type and the surge ratio. null without a surge. */
export function surgeClassOf(item: CatalogItem): SurgeClass | null {
  if (item.surge <= item.watts) return null
  if (item.surgeClass) return item.surgeClass
  if (item.acType === 'conventional') return 'compressor'
  if (item.acType === 'inverter') return 'motor'
  const ratio = item.surge / item.watts
  if (item.cat === 'Kitchen' && ratio >= COMPRESSOR_RATIO) return 'compressor'
  return ratio >= MOTOR_RATIO ? 'motor' : 'inrush'
}

/** The share of each hour the appliance runs: the user's override, the momentary burst math, or the catalog duty. */
export function effectiveDuty(item: CatalogItem, overrides: Record<string, number>): { duty: number; overridden: boolean } {
  const override = overrides[item.id]
  if (typeof override === 'number' && Number.isFinite(override)) {
    return { duty: clamp(override, SIZING.DUTY_MIN, 1), overridden: true }
  }
  if (loadKindOf(item) === 'momentary' && item.burstSeconds && item.cyclesPerHour) {
    // Bursts can add up to well under the override floor: a barrier lifting 4 s thirty times an hour runs 3% of it.
    return { duty: Math.min(1, (item.burstSeconds * item.cyclesPerHour) / SECONDS_PER_HOUR), overridden: false }
  }
  return { duty: item.duty, overridden: false }
}

export function selectItems(items: readonly CatalogItem[], qty: Record<string, number>, hours: number, overrides: Record<string, number>): SelectedItem[] {
  return items
    .filter((a) => (qty[a.id] ?? 0) > 0)
    .map((a) => {
      const n = Math.trunc(qty[a.id] ?? 0)
      const { duty, overridden } = effectiveDuty(a, overrides)
      const startClass = surgeClassOf(a)
      return {
        ...a, qty: n, totalWatts: a.watts * n, wh: Math.round(a.watts * duty * hours * n),
        kind: loadKindOf(a), effectiveDuty: duty, overridden,
        startClass, surgeSeconds: startClass ? SIZING.SURGE_SECONDS[startClass] : 0, surgeDelta: a.surge - a.watts,
      }
    })
}

interface StartUnit extends SurgeStarter { momentary: boolean }

/** Every unit that surges, one entry per unit of quantity, largest surge first. */
function startUnits(items: readonly SelectedItem[]): StartUnit[] {
  return items
    .filter((i) => i.surgeDelta > 0)
    .flatMap((i) => Array.from({ length: i.qty }, () => ({
      itemId: i.id, itemName: i.name, delta: i.surgeDelta, seconds: i.surgeSeconds, momentary: i.kind === 'momentary',
    })))
    .sort((a, b) => b.delta - a.delta || b.seconds - a.seconds || a.itemId.localeCompare(b.itemId))
}

/**
 * The start-up peak: the running load plus the surge of the units assumed to start together. The largest always
 * counts, so one starter gives today's single-motor figure. Momentary loads (a gate) are not assumed to start with
 * the rest unless every motor is.
 */
export function surgeProfile(items: readonly SelectedItem[], runningW: number, starts: SimultaneousStarts): SurgeProfile {
  const all = startUnits(items)
  const first = all[0]
  if (!first) return { surgeW: runningW, seconds: 0, starters: [] }
  const pool = starts === 'all' ? all.slice(1) : all.slice(1).filter((u) => !u.momentary)
  const rest = starts === 'all' ? pool : pool.slice(0, Math.max(0, Math.trunc(starts) - 1))
  const starters = [first, ...rest].map(({ momentary: _m, ...s }) => s)
  return {
    surgeW: runningW + starters.reduce((sum, s) => sum + s.delta, 0),
    seconds: Math.max(...starters.map((s) => s.seconds)),
    starters,
  }
}
