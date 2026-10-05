import { expect, test } from 'vitest'
import type { Requester } from './requester'
import { MAX_SAVED_CLIENTS, byRecent, isSameClient, matchingClient, removeClient, touchClient, upsertClient, type SavedClient } from './saved-clients'

const ana: Requester = { kind: 'person', country: 'VE', name: 'Ana Rondón', contact: '', docPrefix: 'V', doc: '18456789', phone: '', email: '', address: '' }
const robles: Requester = { kind: 'company', country: 'VE', name: 'Inversiones Los Robles C.A.', contact: '', docPrefix: 'J', doc: '401234567', phone: '+58 412 555 0142', email: '', address: '' }
const ids = (...list: string[]) => { let i = 0; return () => list[i++] ?? `id-${i}` }

test('the same ID is the same client, however it is typed', () => {
  expect(isSameClient(ana, { ...ana, name: 'Ana R.', doc: '18.456.789' })).toBe(true)
  expect(isSameClient(ana, { ...ana, doc: '18456780' })).toBe(false)
  expect(isSameClient(ana, { ...ana, docPrefix: 'E' })).toBe(false)
})

test('without an ID on both sides, the name decides, ignoring case, accents and spacing', () => {
  const noDoc = { ...ana, docPrefix: '', doc: '' }
  expect(isSameClient(noDoc, { ...ana, name: '  ana   rondon ' })).toBe(true)
  expect(isSameClient(noDoc, { ...noDoc, name: 'Ana Rondón Pérez' })).toBe(false)
})

test('a different kind or country is never the same client', () => {
  expect(isSameClient(ana, { ...ana, kind: 'company' })).toBe(false)
  expect(isSameClient(ana, { ...ana, country: 'OTHER' })).toBe(false)
})

test('upsert adds a new client, then updates it in place when it comes back', () => {
  const first = upsertClient([], ana, 100, ids('a'))
  expect(first).toEqual({ id: 'a', clients: [{ id: 'a', requester: ana, usedAt: 100 }] })
  const phone = { ...ana, phone: '+58 414 555 0198' }
  const second = upsertClient(first.clients, phone, 200, ids('b'))
  expect(second).toEqual({ id: 'a', clients: [{ id: 'a', requester: phone, usedAt: 200 }] })
})

test('upsert by id replaces that client even when its ID changed', () => {
  const { clients } = upsertClient([], ana, 100, ids('a'))
  const fixed = { ...ana, doc: '18456780' }
  expect(upsertClient(clients, fixed, 200, ids('b'), 'a')).toEqual({ id: 'a', clients: [{ id: 'a', requester: fixed, usedAt: 200 }] })
})

test('the list keeps the most recently used clients when it is full', () => {
  const full: SavedClient[] = Array.from({ length: MAX_SAVED_CLIENTS }, (_, i) => ({
    id: `c${i}`, requester: { ...ana, name: `Client ${i}`, docPrefix: '', doc: '' }, usedAt: i + 1,
  }))
  const { clients } = upsertClient(full, robles, 1000, ids('new'))
  expect(clients).toHaveLength(MAX_SAVED_CLIENTS)
  expect(clients.some((c) => c.id === 'c0')).toBe(false)
  expect(clients.some((c) => c.id === 'new')).toBe(true)
})

test('remove, touch and order by most recent use', () => {
  const list: SavedClient[] = [{ id: 'a', requester: ana, usedAt: 1 }, { id: 'b', requester: robles, usedAt: 5 }]
  expect(removeClient(list, 'a').map((c) => c.id)).toEqual(['b'])
  expect(byRecent(list).map((c) => c.id)).toEqual(['b', 'a'])
  expect(byRecent(touchClient(list, 'a', 9)).map((c) => c.id)).toEqual(['a', 'b'])
  expect(list[0]!.usedAt).toBe(1)
})

test('finds the saved client a project requester belongs to', () => {
  const list: SavedClient[] = [{ id: 'a', requester: ana, usedAt: 1 }, { id: 'b', requester: robles, usedAt: 5 }]
  expect(matchingClient(list, { ...robles, phone: '' })?.id).toBe('b')
  expect(matchingClient(list, { ...ana, doc: '11111111' })).toBeNull()
  expect(matchingClient(list, null)).toBeNull()
})
