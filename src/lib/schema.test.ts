import { expect, test } from 'vitest'
import { SIZING } from './catalog'
import { DEFAULT_ELECTRICAL, StoreSchema } from './schema'

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

test('a saved requester with a malformed ID is dropped, and the project still loads', () => {
  const badRif = { kind: 'company', country: 'VE', name: 'Acme C.A.', contact: '', docPrefix: 'J', doc: '4012', phone: '', email: '', address: '' }
  const parsed = StoreSchema.parse({ version: 1, projects: [{ ...project, requester: badRif }], currentId: 'p1' })
  expect(parsed.projects[0]?.requester).toBeNull()
})

const parseOne = (patch: object) => StoreSchema.parse({ version: 1, projects: [{ ...project, ...patch }], currentId: 'p1' }).projects[0]!

test('a project saved before duty overrides and electrical settings reads as the defaults', () => {
  const p = parseOne({})
  expect(p.dutyOverrides).toEqual({})
  expect(p.electrical).toEqual(DEFAULT_ELECTRICAL)
  expect(DEFAULT_ELECTRICAL).toEqual({ simultaneousStarts: 1, runLengthM: 1.5, ambientC: 30, bundled: false, insulationC: 90 })
})

test('duty overrides keep valid shares and are dropped whole when unreadable, without losing the project', () => {
  expect(parseOne({ dutyOverrides: { fridge: 0.6, ac2c: 1 } }).dutyOverrides).toEqual({ fridge: 0.6, ac2c: 1 })
  expect(parseOne({ dutyOverrides: { fridge: 2 } }).dutyOverrides).toEqual({})
  expect(parseOne({ dutyOverrides: 'x' }).dutyOverrides).toEqual({})
})

test('a partial electrical object keeps the defaults for what it lacks, and a bad field falls back on its own', () => {
  expect(parseOne({ electrical: { ambientC: 40 } }).electrical).toEqual({ ...DEFAULT_ELECTRICAL, ambientC: 40 })
  expect(parseOne({ electrical: { simultaneousStarts: 'all', bundled: true, insulationC: 75, runLengthM: 10 } }).electrical)
    .toEqual({ simultaneousStarts: 'all', runLengthM: 10, ambientC: 30, bundled: true, insulationC: 75 })
  expect(parseOne({ electrical: { ambientC: 35, runLengthM: 99 } }).electrical).toEqual(DEFAULT_ELECTRICAL)
  expect(parseOne({ electrical: 7 }).electrical).toEqual(DEFAULT_ELECTRICAL)
})
