import type { LoadKind } from './catalog'
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
