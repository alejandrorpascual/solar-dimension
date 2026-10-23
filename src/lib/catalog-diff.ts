import { applianceWarnings, type ApplianceInput, type ApplianceRecord } from './catalog-schema'
import { stable } from './stable-json'

const COMPARED = ['category', 'watts', 'surge', 'duty', 'tons', 'acType', 'labels', 'kind', 'surgeClass', 'burstSeconds', 'cyclesPerHour'] as const
const SORT_STEP = 10

export interface FieldChange { field: (typeof COMPARED)[number] | 'sortOrder'; from: unknown; to: unknown }
export type ApplianceChange =
  | { id: string; kind: 'new' }
  | { id: string; kind: 'changed'; fields: FieldChange[] }
  | { id: string; kind: 'unchanged' }

export function diffAppliances(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): ApplianceChange[] {
  const byId = new Map(existing.map((r) => [r.id, r]))
  return incoming.map((item): ApplianceChange => {
    const current = byId.get(item.id)
    if (!current) return { id: item.id, kind: 'new' }
    const content: FieldChange[] = COMPARED.filter((f) => stable(current[f]) !== stable(item[f])).map((field) => ({ field, from: current[field], to: item[field] }))
    // Order is only compared when the caller asks for one; otherwise an item keeps its place.
    const isReordered = item.sortOrder !== undefined && item.sortOrder !== current.sortOrder
    const fields = isReordered ? [...content, { field: 'sortOrder' as const, from: current.sortOrder, to: item.sortOrder }] : content
    return fields.length > 0 ? { id: item.id, kind: 'changed', fields } : { id: item.id, kind: 'unchanged' }
  })
}

export interface ApplianceWarnings { id: string; messages: string[] }

/** The soft checks for each incoming item, against its stored row when it has one. Only items with something to say are listed. */
export function warnAppliances(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): ApplianceWarnings[] {
  const byId = new Map(existing.map((r) => [r.id, r]))
  return incoming
    .map((item) => ({ id: item.id, messages: applianceWarnings(item, byId.get(item.id)) }))
    .filter((w) => w.messages.length > 0)
}

/** Existing items keep their place; new ones go after the last item, in the order given. */
export function assignSortOrders(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): ApplianceRecord[] {
  const byId = new Map(existing.map((r) => [r.id, r]))
  const base = existing.reduce((max, r) => Math.max(max, r.sortOrder), 0)
  const newIds = incoming.filter((i) => !byId.has(i.id)).map((i) => i.id)
  return incoming.map(({ sortOrder, ...item }) => {
    const current = byId.get(item.id)
    const order = sortOrder ?? current?.sortOrder ?? base + (newIds.indexOf(item.id) + 1) * SORT_STEP
    return { ...item, sortOrder: order, retired: current?.retired ?? false }
  })
}

/** One write as the change log keeps it: the row as it was (null for a new row) and the row as written. */
export interface ApplianceWrite { before: ApplianceRecord | null; after: ApplianceRecord }

/** What an upsert does: the change for each item, and the rows it writes. Unchanged items write nothing. */
export function planUpsert(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): { changes: ApplianceChange[]; writes: ApplianceWrite[] } {
  const byId = new Map(existing.map((r) => [r.id, r]))
  const changes = diffAppliances(existing, incoming)
  const writes = assignSortOrders(existing, incoming)
    .filter((_, i) => changes[i]!.kind !== 'unchanged')
    .map((after) => ({ before: byId.get(after.id) ?? null, after }))
  return { changes, writes }
}

/** A retire or restore as one write, or null when the row is already in that state (nothing to write). */
export function retireWrite(current: ApplianceRecord, retired: boolean): ApplianceWrite | null {
  return current.retired === retired ? null : { before: current, after: { ...current, retired } }
}

const LOGGED = [...COMPARED, 'sortOrder', 'retired'] as const
export interface WrittenField { field: (typeof LOGGED)[number]; from: unknown; to: unknown }

/** The fields a logged write changed, from and to. Empty for a new row: there is nothing before it to compare. */
export function writtenFields({ before, after }: ApplianceWrite): WrittenField[] {
  if (!before) return []
  return LOGGED.filter((f) => stable(before[f]) !== stable(after[f])).map((field) => ({ field, from: before[field], to: after[field] }))
}
