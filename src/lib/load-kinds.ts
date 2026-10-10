import type { CatalogItem, LoadKind } from './catalog'
import { effectiveDuty, loadKindOf } from './sizing/loads'
import type { SelectedItem } from './sizing'

/** The order the schedule lists kinds in: what is always on first, then what cycles, then what runs in bursts. */
export const KIND_ORDER: readonly LoadKind[] = ['continuous', 'cycling', 'momentary']

export interface KindGroup { kind: LoadKind; items: SelectedItem[] }

/** Selected items grouped by load kind in KIND_ORDER, keeping each group's catalog order; empty groups are dropped. */
export function groupByKind(items: readonly SelectedItem[]): KindGroup[] {
  return KIND_ORDER
    .map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) }))
    .filter((g) => g.items.length > 0)
}

/** The watts an item draws on average over the window: running watts scaled by its duty. */
export const averageWatts = (item: SelectedItem): number => Math.round(item.totalWatts * item.effectiveDuty)

export type DutyHint =
  | { kind: 'cycling'; pct: number; typicalPct: number; isOverridden: boolean }
  | { kind: 'momentary'; minutesPerHour: number }

const MINUTES_PER_HOUR = 60
const PERCENT = 100

/** A duty (0 to 1) as the whole percent the app shows for it. */
export const dutyPct = (duty: number): number => Math.round(duty * PERCENT)

/**
 * What an appliance card says about how much of each hour it runs: nothing for an always-on load, the share in effect
 * for one that cycles, whole minutes for one that runs in bursts.
 */
export function dutyHint(item: CatalogItem, overrides: Record<string, number>): DutyHint | null {
  const kind = loadKindOf(item)
  if (kind === 'continuous') return null
  const { duty, overridden } = effectiveDuty(item, overrides)
  if (kind === 'momentary') return { kind, minutesPerHour: Math.max(1, Math.round(duty * MINUTES_PER_HOUR)) }
  return { kind, pct: dutyPct(duty), typicalPct: dutyPct(item.duty), isOverridden: overridden }
}
