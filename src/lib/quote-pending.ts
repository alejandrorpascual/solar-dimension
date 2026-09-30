import { setOverride, type ItemId, type Musts, type Override, type Overrides } from './quote-items'

/** What the verdict page lets the user change: the must-haves, and each quote's confirmed items (by quote id). */
export interface VerdictEdits { musts: Musts; overrides: Record<string, Overrides> }

/** One edit whose save hasn't answered yet. `seq` tells two saves of the same item apart. */
interface Pending<T> { value: T; seq: number }
type PendingItems<T> = Partial<Record<ItemId, Pending<T>>>

/** The edits still saving. A null override is a confirmation being cleared. */
export interface PendingEdits {
  musts: PendingItems<boolean>
  overrides: Record<string, PendingItems<Override | null>>
}

export const NO_PENDING: PendingEdits = Object.freeze({ musts: Object.freeze({}), overrides: Object.freeze({}) })

const without = <T>(items: PendingItems<T>, item: ItemId, seq: number): PendingItems<T> =>
  items[item]?.seq === seq ? (Object.fromEntries(Object.entries(items).filter(([k]) => k !== item)) as PendingItems<T>) : items

export function addPendingMust(p: PendingEdits, item: ItemId, value: boolean, seq: number): PendingEdits {
  return { ...p, musts: { ...p.musts, [item]: { value, seq } } }
}

/** Drops the must-have edit once its save answered, unless a newer edit of the same item took its place. */
export function settlePendingMust(p: PendingEdits, item: ItemId, seq: number): PendingEdits {
  const musts = without(p.musts, item, seq)
  return musts === p.musts ? p : { ...p, musts }
}

export function addPendingOverride(p: PendingEdits, quoteId: string, item: ItemId, value: Override | null, seq: number): PendingEdits {
  return { ...p, overrides: { ...p.overrides, [quoteId]: { ...p.overrides[quoteId], [item]: { value, seq } } } }
}

/** Drops the confirmation edit once its save answered, unless a newer edit of the same item took its place. */
export function settlePendingOverride(p: PendingEdits, quoteId: string, item: ItemId, seq: number): PendingEdits {
  const current = p.overrides[quoteId]
  if (!current) return p
  const items = without(current, item, seq)
  if (items === current) return p
  const rest = Object.fromEntries(Object.entries(p.overrides).filter(([id]) => id !== quoteId))
  return { ...p, overrides: Object.keys(items).length ? { ...rest, [quoteId]: items } : rest }
}

const entries = <T>(items: PendingItems<T>): [ItemId, Pending<T>][] => Object.entries(items) as [ItemId, Pending<T>][]

/**
 * The server's data with the edits still saving laid over it, so a reload that lands mid-save never takes back a change
 * the user can see. Quotes the server no longer has are left out.
 */
export function overlayPending(server: VerdictEdits, pending: PendingEdits): VerdictEdits {
  const musts = entries(pending.musts).reduce((m, [item, p]) => ({ ...m, [item]: p.value }), server.musts)
  const overrides = Object.fromEntries(Object.entries(server.overrides).map(([id, o]) => [
    id, entries(pending.overrides[id] ?? {}).reduce((acc, [item, p]) => setOverride(acc, item, p.value), o),
  ]))
  return { musts, overrides }
}
