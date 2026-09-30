import { setOverride, type ItemId, type Musts, type Override, type Overrides } from './quote-items'

/** What the verdict page lets the user change: the must-haves, and each quote's confirmed items (by quote id). */
export interface VerdictEdits { musts: Musts; overrides: Record<string, Overrides> }

/**
 * One edit laid over the server's data. `seq` tells two saves of the same item apart. `settledAt` is the clock tick
 * when its save answered; it stays laid over reloads requested before that tick, which may have read the data first.
 */
interface Pending<T> { value: T; seq: number; settledAt?: number }
type PendingItems<T> = Partial<Record<ItemId, Pending<T>>>

/** The edits still saving, or saved after the latest reload was requested. A null override is a cleared confirmation. */
export interface PendingEdits {
  musts: PendingItems<boolean>
  overrides: Record<string, PendingItems<Override | null>>
}

export const NO_PENDING: PendingEdits = Object.freeze({ musts: Object.freeze({}), overrides: Object.freeze({}) })

/** A counter shared by reloads and saves, so "requested before this save settled" is a plain comparison. */
export interface Clock { tick: () => number }
export function createClock(): Clock {
  let now = 0
  return { tick: () => ++now }
}

const entries = <T>(items: PendingItems<T>): [ItemId, Pending<T>][] => Object.entries(items) as [ItemId, Pending<T>][]

/** Marks `item` settled with `value`, only when `seq` is still its latest edit; otherwise returns `items` itself. */
function settled<T>(items: PendingItems<T>, item: ItemId, seq: number, value: T, at: number): PendingItems<T> {
  return items[item]?.seq === seq ? { ...items, [item]: { value, seq, settledAt: at } } : items
}

export function addPendingMust(p: PendingEdits, item: ItemId, value: boolean, seq: number): PendingEdits {
  return { ...p, musts: { ...p.musts, [item]: { value, seq } } }
}

/**
 * Records that a must-have save answered at tick `at`, keeping `value`: the saved one, or the one a failed save rolled
 * back to. Returns `p` itself when a newer edit of the same item took its place.
 */
export function settlePendingMust(p: PendingEdits, item: ItemId, seq: number, value: boolean, at: number): PendingEdits {
  const musts = settled(p.musts, item, seq, value, at)
  return musts === p.musts ? p : { ...p, musts }
}

export function addPendingOverride(p: PendingEdits, quoteId: string, item: ItemId, value: Override | null, seq: number): PendingEdits {
  return { ...p, overrides: { ...p.overrides, [quoteId]: { ...p.overrides[quoteId], [item]: { value, seq } } } }
}

/** Like settlePendingMust, for one quote's confirmation. */
export function settlePendingOverride(
  p: PendingEdits, quoteId: string, item: ItemId, seq: number, value: Override | null, at: number,
): PendingEdits {
  const current = p.overrides[quoteId]
  if (!current) return p
  const items = settled(current, item, seq, value, at)
  return items === current ? p : { ...p, overrides: { ...p.overrides, [quoteId]: items } }
}

/** Keeps the edits a reload requested at tick `readAt` may not have seen: those still saving or settled after it. */
function unseen<T>(items: PendingItems<T>, readAt: number): PendingItems<T> {
  const kept = entries(items).filter(([, e]) => e.settledAt === undefined || e.settledAt > readAt)
  return kept.length === entries(items).length ? items : (Object.fromEntries(kept) as PendingItems<T>)
}

/**
 * Drops the settled edits that the data of a reload requested at tick `readAt` already has. Returns `p` itself when
 * nothing is dropped.
 */
export function prunePending(p: PendingEdits, readAt: number): PendingEdits {
  const musts = unseen(p.musts, readAt)
  const overrides = Object.entries(p.overrides).flatMap(([id, items]) => {
    const kept = unseen(items, readAt)
    return Object.keys(kept).length ? [[id, kept] as const] : []
  })
  const isSame = musts === p.musts && overrides.length === Object.keys(p.overrides).length
    && overrides.every(([id, items]) => items === p.overrides[id])
  return isSame ? p : { musts, overrides: Object.fromEntries(overrides) }
}

/**
 * The server's data with the pending edits laid over it, so a reload that read the data before a save landed never
 * takes back a change the user can see. Quotes the server no longer has are left out.
 */
export function overlayPending(server: VerdictEdits, pending: PendingEdits): VerdictEdits {
  const musts = entries(pending.musts).reduce((m, [item, p]) => ({ ...m, [item]: p.value }), server.musts)
  const overrides = Object.fromEntries(Object.entries(server.overrides).map(([id, o]) => [
    id, entries(pending.overrides[id] ?? {}).reduce((acc, [item, p]) => setOverride(acc, item, p.value), o),
  ]))
  return { musts, overrides }
}
