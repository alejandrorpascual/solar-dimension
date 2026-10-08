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

test('a saved requester with a malformed ID is dropped, and the project still loads', () => {
  const badRif = { kind: 'company', country: 'VE', name: 'Acme C.A.', contact: '', docPrefix: 'J', doc: '4012', phone: '', email: '', address: '' }
  const parsed = StoreSchema.parse({ version: 1, projects: [{ ...project, requester: badRif }], currentId: 'p1' })
  expect(parsed.projects[0]?.requester).toBeNull()
})

const solar = { roofM2: 40, panels: null, sunHours: 4.8 }

test('a project has no solar choice until one is made, and keeps a valid one', () => {
  expect(StoreSchema.parse({ version: 1, projects: [project], currentId: 'p1' }).projects[0]?.solar).toBeNull()
  expect(StoreSchema.parse({ version: 1, projects: [{ ...project, solar }], currentId: 'p1' }).projects[0]?.solar).toEqual(solar)
  expect(StoreSchema.parse({ version: 1, projects: [{ ...project, solar: { ...solar, panels: 12 } }], currentId: 'p1' }).projects[0]?.solar?.panels).toBe(12)
})

test('an unreadable solar choice is dropped instead of losing every saved project', () => {
  const parsed = StoreSchema.safeParse({ version: 1, projects: [{ ...project, solar: { roofM2: 'big' } }], currentId: 'p1' })
  expect(parsed.success).toBe(true)
  expect(parsed.data?.projects[0]?.solar).toBeNull()
})

test('solar values outside their ranges are dropped', () => {
  for (const bad of [{ ...solar, roofM2: 0 }, { ...solar, roofM2: 501 }, { ...solar, sunHours: 2 }, { ...solar, sunHours: 7 }, { ...solar, panels: -1 }, { ...solar, panels: 1.5 }]) {
    expect(StoreSchema.parse({ version: 1, projects: [{ ...project, solar: bad }], currentId: 'p1' }).projects[0]?.solar).toBeNull()
  }
})
