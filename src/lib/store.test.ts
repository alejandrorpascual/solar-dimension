import { describe, expect, test } from 'vitest'
import {
  addCustom, addProject, currentProject, deleteProject, duplicateProject, initialStore, parseQty, patchCurrent, removeCustom, selectProject, setQty,
} from './store'

describe('project store', () => {
  test('starts with one Home project of essentials at 48 V for 10 h', () => {
    const s = initialStore()
    expect(s.projects).toHaveLength(1)
    const p = currentProject(s)
    expect(p.name).toBe('Home')
    expect(p.qty.fridge).toBe(1)
    expect(p.volts).toBe(48)
    expect(p.hours).toBe(10)
    expect(p.updatedAt).toBe(0)
    expect(p.batteryUnit).toBeNull()
  })

  test('new and duplicated projects keep the battery choice rules', () => {
    const chosen = patchCurrent(initialStore(), { batteryUnit: '12-200' })
    expect(currentProject(chosen).batteryUnit).toBe('12-200')
    expect(currentProject(duplicateProject(chosen)).batteryUnit).toBe('12-200')
    expect(currentProject(addProject(chosen)).batteryUnit).toBeNull()
  })

  test('every edit stamps the project with a newer updatedAt', () => {
    const s = initialStore()
    const edited = patchCurrent(s, { hours: 24 })
    expect(currentProject(edited).updatedAt).toBeGreaterThan(0)
    expect(currentProject(addProject(s)).updatedAt).toBeGreaterThan(0)
    expect(currentProject(duplicateProject(s)).updatedAt).toBeGreaterThan(0)
    expect(currentProject(setQty(s, 'fridge', 2)).updatedAt).toBeGreaterThan(0)
  })

  test('setQty clamps between 0 and 100 and does not mutate the input', () => {
    const s = initialStore()
    const before = JSON.stringify(s)
    const s2 = setQty(setQty(s, 'ac2c', 150), 'fridge', -3)
    expect(currentProject(s2).qty.ac2c).toBe(100)
    expect(currentProject(s2).qty.fridge).toBe(0)
    expect(JSON.stringify(s)).toBe(before)
  })

  test('parseQty accepts whole numbers and rejects everything else', () => {
    expect(parseQty('32')).toBe(32)
    expect(parseQty(' 7 ')).toBe(7)
    expect(parseQty('0')).toBe(0)
    for (const bad of ['', ' ', '-1', '2.5', 'abc', '1e3']) expect(parseQty(bad)).toBeNull()
  })

  test('add, duplicate, select and delete keep ids unique and at least one project', () => {
    let s = addProject(initialStore(), 'Office')
    const officeId = s.currentId
    expect(officeId).not.toBe('p1')
    s = duplicateProject(s)
    expect(currentProject(s).name).toBe('Office copy')
    expect(new Set(s.projects.map((p) => p.id)).size).toBe(3)
    s = selectProject(s, 'p1')
    s = deleteProject(s)
    expect(s.projects.map((p) => p.id)).not.toContain('p1')
    expect(s.currentId).toBe(officeId)
    s = deleteProject(deleteProject(s))
    expect(s.projects).toHaveLength(1)
  })

  test('addCustom selects one unit and removeCustom clears it', () => {
    const item = { id: 'custom1', name: 'Pool pump', watts: 1035, surge: 2500, note: 'Custom · 230 V × 4.5 A' }
    let s = addCustom(initialStore(), item)
    expect(currentProject(s).custom).toEqual([item])
    expect(currentProject(s).qty.custom1).toBe(1)
    s = removeCustom(s, 'custom1')
    expect(currentProject(s).custom).toEqual([])
    expect(currentProject(s).qty.custom1).toBeUndefined()
  })

  test('patchCurrent changes only the current project', () => {
    const s = addProject(initialStore())
    const s2 = patchCurrent(s, { hours: 24 })
    expect(s2.projects[0]?.hours).toBe(10)
    expect(s2.projects[1]?.hours).toBe(24)
  })
})
