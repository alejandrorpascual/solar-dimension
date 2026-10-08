import { describe, expect, test } from 'vitest'
import {
  addCustom, addProject, clampHours, currentProject, deleteProject, duplicateProject, initialStore, parseQty, patchCurrent, patchProject,
  hasSameLoads, removeCustom, restoreProject, selectProject, setHoursIn, setQty, setQtyIn,
  setSolarIn, withSolarPanels, withSolarRoof, withSolarSun,
} from './store'
import { SOLAR } from './solar'

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

  test("a new project has no requester, and a duplicate keeps the original's", () => {
    const requester = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' } as const
    const s = patchCurrent(initialStore(), { requester })
    expect(currentProject(initialStore()).requester).toBeNull()
    expect(currentProject(addProject(s)).requester).toBeNull()
    expect(currentProject(duplicateProject(s)).requester).toEqual(requester)
  })
})

describe('editing any project, not just the open one', () => {
  const twoProjects = () => {
    const s = addProject(initialStore(), 'Office')
    return { s, homeId: s.projects[0]!.id, officeId: s.projects[1]!.id }
  }

  test('setQtyIn changes only the named project and stamps it', () => {
    const { s, homeId, officeId } = twoProjects()
    const next = setQtyIn(s, homeId, 'tv', 3)
    const home = next.projects.find((p) => p.id === homeId)!
    expect(home.qty.tv).toBe(3)
    expect(home.updatedAt).toBeGreaterThan(0)
    expect(next.projects.find((p) => p.id === officeId)).toBe(s.projects[1])
    expect(next.currentId).toBe(officeId)
  })

  test('setQtyIn clamps to the allowed range and ignores unknown projects', () => {
    const { s, homeId } = twoProjects()
    expect(setQtyIn(s, homeId, 'tv', 500).projects[0]!.qty.tv).toBe(100)
    expect(setQtyIn(s, homeId, 'tv', -2).projects[0]!.qty.tv).toBe(0)
    expect(setQtyIn(s, 'nope', 'tv', 2)).toBe(s)
  })

  test('setHoursIn keeps the window between 1 and 72 whole hours', () => {
    const { s, homeId } = twoProjects()
    expect(setHoursIn(s, homeId, 0).projects[0]!.hours).toBe(1)
    expect(setHoursIn(s, homeId, 99).projects[0]!.hours).toBe(72)
    expect(setHoursIn(s, homeId, 10.7).projects[0]!.hours).toBe(10)
    expect(clampHours(Number.NaN)).toBe(1)
  })

  test('hasSameLoads ignores zero quantities and notices hours, quantities and custom loads', () => {
    const { s, homeId } = twoProjects()
    const home = s.projects[0]!
    const zeroed = setQtyIn(setQtyIn(s, homeId, 'tv', 0), homeId, 'tv', 1).projects[0]!
    const withEmptyKey = patchProject(s, homeId, { qty: { ...home.qty, kettle: 0 } }).projects[0]!
    expect(hasSameLoads(home, zeroed)).toBe(true)
    expect(hasSameLoads(home, withEmptyKey)).toBe(true)
    expect(hasSameLoads(home, setQtyIn(s, homeId, 'tv', 2).projects[0]!)).toBe(false)
    expect(hasSameLoads(home, setHoursIn(s, homeId, 11).projects[0]!)).toBe(false)
    const custom = { id: 'c1', name: 'Pump', watts: 500, surge: 1500, note: '' }
    expect(hasSameLoads(home, { ...home, custom: [custom] })).toBe(false)
  })

  test('restoreProject puts back quantities, custom loads and hours but keeps later renames', () => {
    const { s, homeId } = twoProjects()
    const snapshot = s.projects[0]!
    const edited = patchProject(setHoursIn(setQtyIn(s, homeId, 'fridge', 4), homeId, 30), homeId, { name: 'Casa' })
    const home = restoreProject(edited, snapshot).projects.find((p) => p.id === homeId)!
    expect(home.qty).toEqual(snapshot.qty)
    expect(home.hours).toBe(snapshot.hours)
    expect(home.name).toBe('Casa')
    expect(home.updatedAt).toBeGreaterThan(0)
  })
})

test('a new project is battery-only', () => {
  expect(currentProject(initialStore()).solar).toBeNull()
})

test('setSolarIn turns panels on with the defaults and off again', () => {
  const store = initialStore()
  const id = currentProject(store).id
  const on = setSolarIn(store, id, true)
  expect(currentProject(on).solar).toEqual({ roofM2: 40, panels: null, sunHours: SOLAR.DEFAULT_SUN_HOURS })
  expect(currentProject(setSolarIn(on, id, false)).solar).toBeNull()
  expect(setSolarIn(store, 'nope', true)).toBe(store)
})

test('turning panels on again keeps the previous choice', () => {
  const store = initialStore()
  const id = currentProject(store).id
  const tuned = withSolarPanels(setSolarIn(store, id, true), id, 12)
  expect(currentProject(setSolarIn(tuned, id, true)).solar?.panels).toBe(12)
})

test('roof, sun and panels are clamped and snapped to their steps', () => {
  const store = setSolarIn(initialStore(), 'p1', true)
  expect(currentProject(withSolarRoof(store, 'p1', 9999)).solar?.roofM2).toBe(500)
  expect(currentProject(withSolarRoof(store, 'p1', 0)).solar?.roofM2).toBe(5)
  expect(currentProject(withSolarRoof(store, 'p1', 42)).solar?.roofM2).toBe(40)
  expect(currentProject(withSolarSun(store, 'p1', 0)).solar?.sunHours).toBe(3)
  expect(currentProject(withSolarSun(store, 'p1', 5.3)).solar?.sunHours).toBe(5.5)
  expect(currentProject(withSolarPanels(store, 'p1', -3)).solar?.panels).toBe(0)
  expect(currentProject(withSolarPanels(store, 'p1', null)).solar?.panels).toBeNull()
})

test('solar edits on a battery-only project do nothing', () => {
  const store = initialStore()
  expect(withSolarPanels(store, 'p1', 3)).toBe(store)
})
