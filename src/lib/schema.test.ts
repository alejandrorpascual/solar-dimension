import { expect, test } from 'vitest'
import { SIZING } from './catalog'
import { StoreSchema } from './schema'

const project = { id: 'p1', name: 'Home', qty: { fridge: 1 }, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4' }

test('accepts a valid store', () => {
  expect(StoreSchema.safeParse({ version: 1, projects: [project], currentId: 'p1' }).success).toBe(true)
})

test('rejects unknown voltage, out-of-range hours and empty project lists', () => {
  expect(StoreSchema.safeParse({ version: 1, projects: [{ ...project, volts: 60 }], currentId: 'p1' }).success).toBe(false)
  expect(StoreSchema.safeParse({ version: 1, projects: [{ ...project, hours: 0 }], currentId: 'p1' }).success).toBe(false)
  expect(StoreSchema.safeParse({ version: 1, projects: [], currentId: 'p1' }).success).toBe(false)
})

test('battery unit defaults to automatic (null) and accepts a unit id', () => {
  expect(StoreSchema.parse({ version: 1, projects: [project], currentId: 'p1' }).projects[0]?.batteryUnit).toBeNull()
  expect(StoreSchema.parse({ version: 1, projects: [{ ...project, batteryUnit: '12-200' }], currentId: 'p1' }).projects[0]?.batteryUnit).toBe('12-200')
  expect(StoreSchema.safeParse({ version: 1, projects: [{ ...project, batteryUnit: 'x'.repeat(40) }], currentId: 'p1' }).success).toBe(false)
})

test('defaults updatedAt to 0 and rejects negative stamps', () => {
  const parsed = StoreSchema.parse({ version: 1, projects: [project], currentId: 'p1' })
  expect(parsed.projects[0]?.updatedAt).toBe(0)
  expect(StoreSchema.safeParse({ version: 1, projects: [{ ...project, updatedAt: -1 }], currentId: 'p1' }).success).toBe(false)
})

test('rejects quantities above the catalog maximum and unknown versions', () => {
  expect(StoreSchema.safeParse({ version: 1, projects: [{ ...project, qty: { cctv: SIZING.MAX_QTY } }], currentId: 'p1' }).success).toBe(true)
  expect(StoreSchema.safeParse({ version: 1, projects: [{ ...project, qty: { fridge: SIZING.MAX_QTY + 1 } }], currentId: 'p1' }).success).toBe(false)
  expect(StoreSchema.safeParse({ version: 2, projects: [project], currentId: 'p1' }).success).toBe(false)
})

const requester = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' }

test('a project has no requester until one is added, and keeps a valid one', () => {
  expect(StoreSchema.parse({ version: 1, projects: [project], currentId: 'p1' }).projects[0]?.requester).toBeNull()
  expect(StoreSchema.parse({ version: 1, projects: [{ ...project, requester }], currentId: 'p1' }).projects[0]?.requester).toEqual(requester)
})

test('an unreadable requester is dropped instead of losing every saved project', () => {
  const parsed = StoreSchema.safeParse({ version: 1, projects: [{ ...project, requester: { name: 42 } }], currentId: 'p1' })
  expect(parsed.success).toBe(true)
  expect(parsed.data?.projects[0]?.requester).toBeNull()
})
