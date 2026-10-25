import { ApplianceSchema, applianceWarnings, type ApplianceInput, type ApplianceRecord } from './catalog-schema'
import { stable } from './stable-json'

const COMPARED = ['category', 'watts', 'surge', 'duty', 'tons', 'acType', 'labels', 'kind', 'surgeClass', 'burstSeconds', 'cyclesPerHour'] as const
const SORT_STEP = 10

export interface FieldChange { field: (typeof COMPARED)[number] | 'sources' | 'sortOrder'; from: unknown; to: unknown }
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
    // Sources and order are only compared when the caller sends them; otherwise an item keeps its stored ones.
    const storedSources = current.sources ?? {}
    const hasNewSources = item.sources !== undefined && stable(item.sources) !== stable(storedSources)
    const isReordered = item.sortOrder !== undefined && item.sortOrder !== current.sortOrder
    const fields = [
      ...content,
      ...(hasNewSources ? [{ field: 'sources' as const, from: storedSources, to: item.sources }] : []),
      ...(isReordered ? [{ field: 'sortOrder' as const, from: current.sortOrder, to: item.sortOrder }] : []),
    ]
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

/** The row as written: an item that sends no sources keeps the stored row's. */
export const keepStoredSources = (after: ApplianceRecord, before: ApplianceRecord | null): ApplianceRecord =>
  after.sources !== undefined || before?.sources === undefined ? after : { ...after, sources: before.sources }

/** What an upsert does: the change for each item, and the rows it writes. Unchanged items write nothing. */
export function planUpsert(existing: readonly ApplianceRecord[], incoming: readonly ApplianceInput[]): { changes: ApplianceChange[]; writes: ApplianceWrite[] } {
  const byId = new Map(existing.map((r) => [r.id, r]))
  const changes = diffAppliances(existing, incoming)
  const writes = assignSortOrders(existing, incoming)
    .filter((_, i) => changes[i]!.kind !== 'unchanged')
    .map((after) => {
      const before = byId.get(after.id) ?? null
      return { before, after: keepStoredSources(after, before) }
    })
  return { changes, writes }
}

/** A retire or restore as one write, or null when the row is already in that state (nothing to write). */
export function retireWrite(current: ApplianceRecord, retired: boolean): ApplianceWrite | null {
  return current.retired === retired ? null : { before: current, after: { ...current, retired } }
}

const LOGGED = [...COMPARED, 'sources', 'sortOrder', 'retired'] as const
export interface WrittenField { field: (typeof LOGGED)[number]; from: unknown; to: unknown }

/** The fields a logged write changed, from and to. Empty for a new row: there is nothing before it to compare. */
export function writtenFields({ before, after }: ApplianceWrite): WrittenField[] {
  if (!before) return []
  return LOGGED.filter((f) => stable(before[f]) !== stable(after[f])).map((field) => ({ field, from: before[field], to: after[field] }))
}

/** Why a logged change cannot be reverted: it created the row, or the row it kept fails the schema (edited by hand). */
export type RevertRefusal = 'created' | 'invalid'

/**
 * What reverting a logged change writes: the row as it is now, back to the entry's "before", every logged field
 * included (retired and sort order too). 'unchanged' when the row already holds those values: nothing to write.
 */
export function revertWrite(current: ApplianceRecord, before: ApplianceRecord | null): ApplianceWrite | RevertRefusal | 'unchanged' {
  if (!before) return 'created'
  const { retired, ...fields } = before
  if (!ApplianceSchema.safeParse(fields).success) return 'invalid'
  const write = { before: current, after: before }
  return writtenFields(write).length > 0 ? write : 'unchanged'
}
