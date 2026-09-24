import { describe, expect, test } from 'vitest'
import {
  addCustom, addProject, currentProject, deleteProject, duplicateProject, initialStore, patchCurrent, removeCustom, selectProject, setQty,
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
  })

  test('setQty clamps between 0 and 20 and does not mutate the input', () => {
    const s = initialStore()
    const before = JSON.stringify(s)
    const s2 = setQty(setQty(s, 'ac2c', 25), 'fridge', -3)
    expect(currentProject(s2).qty.ac2c).toBe(20)
    expect(currentProject(s2).qty.fridge).toBe(0)
    expect(JSON.stringify(s)).toBe(before)
  })

  test('add, duplicate, select and delete keep ids unique and at least one project', () => {
    let s = addProject(initialStore(), 'Office')
    expect(s.currentId).toBe('p2')
    s = duplicateProject(s)
    expect(currentProject(s).name).toBe('Office copy')
    expect(s.projects.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    s = selectProject(s, 'p1')
    s = deleteProject(s)
    expect(s.projects.map((p) => p.id)).toEqual(['p2', 'p3'])
    expect(s.currentId).toBe('p2')
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
