import { z } from 'zod'
import { RequesterSchema, type Requester } from './requester'

/** A client kept in this browser so the next spec sheet is one tap away. `usedAt` orders the list and decides what the cap drops. */
export const SavedClientSchema = z.object({ id: z.string().min(1), requester: RequesterSchema, usedAt: z.number() })
export type SavedClient = z.infer<typeof SavedClientSchema>

export const MAX_SAVED_CLIENTS = 50

const DIACRITICS = /\p{Diacritic}/gu
const comparableName = (name: string): string => name.normalize('NFD').replace(DIACRITICS, '').toLowerCase().trim().replace(/\s+/g, ' ')
const comparableDoc = (r: Requester): string => {
  const doc = r.doc.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return doc ? `${r.docPrefix}${doc}` : ''
}

/** Same kind and country, then the same ID when both have one; without, the same name (case, accents and spacing aside). */
export function isSameClient(a: Requester, b: Requester): boolean {
  if (a.kind !== b.kind || a.country !== b.country) return false
  const docA = comparableDoc(a)
  const docB = comparableDoc(b)
  if (docA && docB) return docA === docB
  return comparableName(a.name) === comparableName(b.name)
}

export function byRecent(clients: readonly SavedClient[]): SavedClient[] {
  return [...clients].sort((a, b) => b.usedAt - a.usedAt)
}

/**
 * Saves a requester as a client: the one with `id` when given (an edit may change its ID), else the one it matches, else
 * a new entry. Over the cap, the least recently used client goes.
 */
export function upsertClient(
  clients: readonly SavedClient[], requester: Requester, now: number, newId: () => string, id?: string,
): { id: string; clients: SavedClient[] } {
  const existing = (id ? clients.find((c) => c.id === id) : undefined) ?? clients.find((c) => isSameClient(c.requester, requester))
  const saved: SavedClient = { id: existing?.id ?? newId(), requester, usedAt: now }
  const rest = clients.filter((c) => c.id !== saved.id)
  return { id: saved.id, clients: byRecent([saved, ...rest]).slice(0, MAX_SAVED_CLIENTS) }
}

export function removeClient(clients: readonly SavedClient[], id: string): SavedClient[] {
  return clients.filter((c) => c.id !== id)
}

export function touchClient(clients: readonly SavedClient[], id: string, now: number): SavedClient[] {
  return clients.map((c) => (c.id === id ? { ...c, usedAt: now } : c))
}

/** The saved client a project's requester belongs to, if any. */
export function matchingClient(clients: readonly SavedClient[], requester: Requester | null): SavedClient | null {
  if (!requester) return null
  return clients.find((c) => isSameClient(c.requester, requester)) ?? null
}
