import { expect, test } from 'vitest'
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

test('rejects quantities above the catalog maximum and unknown versions', () => {
  expect(StoreSchema.safeParse({ version: 1, projects: [{ ...project, qty: { fridge: 21 } }], currentId: 'p1' }).success).toBe(false)
  expect(StoreSchema.safeParse({ version: 2, projects: [project], currentId: 'p1' }).success).toBe(false)
})
