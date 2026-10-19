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

test('a custom appliance that no longer parses is dropped by itself; the project and its other loads stay', () => {
  const good = { id: 'custom1', name: 'Pool pump', watts: 1035, surge: 2500, note: 'Custom · 230 V × 4.5 A' }
  const longName = { id: 'custom2', name: 'x'.repeat(93), watts: 180, surge: 180, note: 'Custom · 180 W' }
  const zeroWatts = { id: 'custom3', name: 'Standby LED', watts: 0, surge: 0, note: 'Custom · 0 W' }
  const parsed = StoreSchema.parse({ version: 1, projects: [{ ...project, qty: { fridge: 1, custom1: 1, custom2: 1 }, custom: [good, longName, zeroWatts, 'not a load'] }], currentId: 'p1' })
  expect(parsed.projects[0]?.custom).toEqual([good])
  // The count stays, so the kit can say an appliance was left out.
  expect(parsed.projects[0]?.qty).toEqual({ fridge: 1, custom1: 1, custom2: 1 })
})

test('a custom appliance keeps the share of each hour it runs; one saved before it had one reads as before', () => {
  const pump = { id: 'custom1', name: 'Pool pump', watts: 1035, surge: 2500, note: 'Custom · 1035 W', duty: 0.3 }
  const old = { id: 'custom2', name: 'Heater', watts: 750, surge: 750, note: 'Custom · 750 W' }
  const custom = StoreSchema.parse({ version: 1, projects: [{ ...project, custom: [pump, old] }], currentId: 'p1' }).projects[0]?.custom
  expect(custom).toEqual([pump, old])
  expect(custom?.[1]).not.toHaveProperty('duty')
})

test('a custom appliance whose saved duty is not a share of an hour is dropped by itself', () => {
  const load = { id: 'custom1', name: 'Pump', watts: 500, surge: 500, note: 'Custom · 500 W' }
  for (const duty of [0, -0.2, 1.5, '0.3', null]) {
    expect(StoreSchema.parse({ version: 1, projects: [{ ...project, custom: [{ ...load, duty }] }], currentId: 'p1' }).projects[0]?.custom, String(duty)).toEqual([])
  }
})

test('an unreadable custom list reads as empty instead of losing every saved project', () => {
  const store = { version: 1, projects: [project, { ...project, id: 'p2', custom: 'oops' }, { ...project, id: 'p3', custom: null }], currentId: 'p1' }
  expect(StoreSchema.parse(store).projects.map((p) => [p.id, p.custom])).toEqual([['p1', []], ['p2', []], ['p3', []]])
})

