import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { EMPTY_FORM, parseCustom } from './custom'
import { compute } from './sizing'
import {
  addCustom, addProject, clampHours, currentProject, deleteProject, duplicateProject, initialStore, parseQty, patchCurrent, patchProject,
  hasSameLoads, rekeySeed, removeCustom, removeUnreadCustom, restoreProject, selectProject, setDutyIn, setElectricalIn, setHoursIn, setQty, setQtyIn,
  renameProject, setSolarIn, takenLoadIds, unreadCustomCount, withSetAside, withSolarPanels, withSolarRoof, withSolarSun,
} from './store'
import { SOLAR } from './solar'
import { DEFAULT_ELECTRICAL, PROJECT_NAME_MAX, ProjectSchema, StoreSchema, type Project, type Store } from './schema'

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

describe('duty overrides and electrical settings', () => {
  test('a new project has no overrides and the default electrical settings; a duplicate copies both', () => {
    const s = initialStore()
    expect(currentProject(s).dutyOverrides).toEqual({})
    expect(currentProject(s).electrical).toEqual(DEFAULT_ELECTRICAL)
    const edited = setElectricalIn(setDutyIn(s, 'p1', 'fridge', 0.6), 'p1', { ambientC: 50 })
    const copy = currentProject(duplicateProject(edited))
    expect(copy.dutyOverrides).toEqual({ fridge: 0.6 })
    expect(copy.electrical.ambientC).toBe(50)
    expect(copy.dutyOverrides).not.toBe(currentProject(edited).dutyOverrides)
    expect(currentProject(addProject(edited)).dutyOverrides).toEqual({})
  })

  test('setDutyIn clamps, null restores the catalog value, and unknown projects are ignored', () => {
    const s = initialStore()
    expect(currentProject(setDutyIn(s, 'p1', 'fridge', 5)).dutyOverrides).toEqual({ fridge: 1 })
    expect(currentProject(setDutyIn(s, 'p1', 'fridge', -1)).dutyOverrides).toEqual({ fridge: 0.01 })
    expect(currentProject(setDutyIn(s, 'p1', 'fridge', Number.NaN)).dutyOverrides).toEqual({ fridge: 0.01 })
    const set = setDutyIn(s, 'p1', 'fridge', 0.6)
    expect(currentProject(set).updatedAt).toBeGreaterThan(0)
    expect(currentProject(setDutyIn(set, 'p1', 'fridge', null)).dutyOverrides).toEqual({})
    expect(setDutyIn(s, 'nope', 'fridge', 0.5)).toBe(s)
  })

  test('setElectricalIn patches one field, keeps the rest and stamps the project', () => {
    const s = setElectricalIn(initialStore(), 'p1', { simultaneousStarts: 'all' })
    expect(currentProject(s).electrical).toEqual({ ...DEFAULT_ELECTRICAL, simultaneousStarts: 'all' })
    expect(currentProject(s).updatedAt).toBeGreaterThan(0)
    expect(setElectricalIn(s, 'nope', { bundled: true })).toBe(s)
  })

  test('removing a custom load drops its override, and undo compares and restores overrides', () => {
    const item = { id: 'custom1', name: 'Pool pump', watts: 1035, surge: 2500, note: '' }
    let s = setDutyIn(addCustom(initialStore(), item), 'p1', 'custom1', 0.3)
    expect(currentProject(s).dutyOverrides).toEqual({ custom1: 0.3 })
    s = removeCustom(s, 'custom1')
    expect(currentProject(s).dutyOverrides).toEqual({})
    const snapshot = currentProject(s)
    const changed = setDutyIn(s, 'p1', 'fridge', 1)
    expect(hasSameLoads(snapshot, currentProject(changed))).toBe(false)
    expect(currentProject(restoreProject(changed, snapshot)).dutyOverrides).toEqual({})
  })
})

describe('a custom appliance the project could not read back', () => {
  const POOL_PUMP = { id: 'custom2', name: 'Pool pump', watts: 1035, surge: 2500, note: '' }
  /** What a reload leaves of a saved custom appliance that no longer parses: its count and its duty, and no appliance. */
  const recovered = (extra: Partial<Project> = {}): Store => {
    const base = initialStore().projects[0]!
    const unreadable = { id: 'custom1', name: 'x'.repeat(93), watts: 900, surge: 900, note: '' }
    const saved = { ...base, qty: { fridge: 1, custom1: 3 }, dutyOverrides: { custom1: 0.25 }, ...extra, custom: [unreadable, ...(extra.custom ?? [])] }
    return { ...initialStore(), projects: [ProjectSchema.parse(saved)] }
  }
  const missingNotice = (p: Project) => compute(p, CATALOG_SNAPSHOT).warnings.filter((w) => w.code === 'missingAppliances')
  /** The form's own path: the next id is chosen from what the project already holds. */
  const addFromForm = (store: Store, name: string): Store => {
    const parsed = parseCustom({ ...EMPTY_FORM, name, watts: '10' }, takenLoadIds(currentProject(store)))
    if (!parsed.ok) throw new Error(parsed.error)
    return addCustom(store, parsed.item)
  }

  test('an appliance added afterwards takes a new id: the lost one keeps its count, its duty and the notice on the kit', () => {
    // Arrange
    const store = recovered()
    expect(currentProject(store).custom).toEqual([])

    // Act
    const after = currentProject(addFromForm(store, 'Phone charger'))

    // Assert
    expect(after.custom.map((c) => c.id)).toEqual(['custom2'])
    expect(after.qty).toMatchObject({ custom1: 3, custom2: 1 })
    expect(after.dutyOverrides).toEqual({ custom1: 0.25 })
    expect(missingNotice(after)).toEqual([{ code: 'missingAppliances', params: { count: 1 } }])
  })

  test('one saved above the catalog ceiling of 30,000 W running or 120,000 W surge is dropped with the notice', () => {
    // Arrange
    const base = initialStore().projects[0]!
    const custom = [
      { id: 'custom1', name: 'Typo', watts: 30_001, surge: 30_001, note: '' },
      { id: 'custom2', name: 'Huge start', watts: 30_000, surge: 120_001, note: '' },
      { id: 'custom3', name: 'At the ceiling', watts: 30_000, surge: 120_000, note: '' },
    ]

    // Act
    const project = ProjectSchema.parse({ ...base, qty: { custom1: 1, custom2: 1, custom3: 1 }, custom })

    // Assert
    expect(project.custom.map((c) => c.id)).toEqual(['custom3'])
    expect(unreadCustomCount(project)).toBe(2)
    expect(missingNotice(project)).toEqual([{ code: 'missingAppliances', params: { count: 2 } }])
  })

  test('it is counted until it is removed, and removing it takes its count, its duty and the notice with it', () => {
    // Arrange
    const store = recovered()
    expect(unreadCustomCount(currentProject(store))).toBe(1)

    // Act
    const cleared = currentProject(removeUnreadCustom(store))

    // Assert
    expect(cleared.qty).toEqual({ fridge: 1 })
    expect(cleared.dutyOverrides).toEqual({})
    expect(unreadCustomCount(cleared)).toBe(0)
    expect(missingNotice(cleared)).toEqual([])
  })

  test('removing it leaves the custom appliances that load and anything the catalog may still bring back', () => {
    // Arrange: one custom appliance that reads, and a catalog id this list does not have.
    const store = recovered({
      custom: [POOL_PUMP], qty: { fridge: 1, custom1: 3, custom2: 2, 'retired-heater': 1 }, dutyOverrides: { custom1: 0.25, custom2: 0.5, fridge: 0.4 },
    })
    expect(unreadCustomCount(currentProject(store))).toBe(1)

    // Act
    const cleared = currentProject(removeUnreadCustom(store))

    // Assert
    expect(cleared.custom).toEqual([POOL_PUMP])
    expect(cleared.qty).toEqual({ fridge: 1, custom2: 2, 'retired-heater': 1 })
    expect(cleared.dutyOverrides).toEqual({ custom2: 0.5, fridge: 0.4 })
    expect(missingNotice(cleared)).toEqual([{ code: 'missingAppliances', params: { count: 1 } }])
  })

  test('one the kit was not counting is not reported, yet its id is still not handed out', () => {
    // Arrange: its quantity had been set to zero before it stopped loading.
    const store = recovered({ qty: { fridge: 1, custom1: 0 } })
    const project = currentProject(store)

    // Act
    const after = currentProject(addFromForm(store, 'Phone charger'))

    // Assert
    expect(unreadCustomCount(project)).toBe(0)
    expect(missingNotice(project)).toEqual([])
    expect(after.custom.map((c) => c.id)).toEqual(['custom2'])
    expect(after.dutyOverrides).toEqual({ custom1: 0.25 })
    expect(currentProject(removeUnreadCustom(store)).dutyOverrides).toEqual({})
  })

  test('a project with nothing lost is returned as it is', () => {
    const store = addCustom(initialStore(), { ...POOL_PUMP, id: 'custom1' })
    expect(unreadCustomCount(currentProject(store))).toBe(0)
    expect(removeUnreadCustom(store)).toBe(store)
  })
})

describe("a duplicate's name", () => {
  const COPY_SUFFIX = ' copy'
  const named = (name: string) => patchCurrent(initialStore(), { name })

  test('a short name is kept whole and gains the suffix', () => {
    // Arrange
    const store = named('Beach house')

    // Act
    const copy = currentProject(duplicateProject(store))

    // Assert
    expect(copy.name).toBe(`Beach house${COPY_SUFFIX}`)
  })

  test('a name at the stored limit is shortened so the copy still ends in the suffix and the store still loads', () => {
    // Arrange
    const longest = 'x'.repeat(PROJECT_NAME_MAX)
    const store = named(longest)

    // Act
    const duplicated = duplicateProject(store)
    const copy = currentProject(duplicated)

    // Assert
    expect(copy.name.length).toBeLessThanOrEqual(PROJECT_NAME_MAX)
    expect(copy.name.endsWith(COPY_SUFFIX)).toBe(true)
    expect(copy.name).toBe(`${longest.slice(0, PROJECT_NAME_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`)
    expect(StoreSchema.safeParse(duplicated).success).toBe(true)
  })

  test('every name from the longest that fits to the limit gives a copy the schema accepts', () => {
    // Arrange
    const longestThatFits = PROJECT_NAME_MAX - COPY_SUFFIX.length
    const lengths = Array.from({ length: COPY_SUFFIX.length + 1 }, (_, i) => longestThatFits + i)

    // Act
    const copies = lengths.map((length) => duplicateProject(named('x'.repeat(length))))

    // Assert
    for (const duplicated of copies) {
      expect(currentProject(duplicated).name).toHaveLength(PROJECT_NAME_MAX)
      expect(currentProject(duplicated).name.endsWith(COPY_SUFFIX)).toBe(true)
      expect(StoreSchema.safeParse(duplicated).success).toBe(true)
    }
  })

  test('a name cut at a space does not leave two spaces before the suffix', () => {
    // Arrange
    const cutAt = PROJECT_NAME_MAX - COPY_SUFFIX.length
    const store = named(`${'x'.repeat(cutAt - 1)} tail`)

    // Act
    const copy = currentProject(duplicateProject(store))

    // Assert
    expect(copy.name).toBe(`${'x'.repeat(cutAt - 1)}${COPY_SUFFIX}`)
  })

  test('duplicating a copy of a long name again still fits', () => {
    // Arrange
    const once = duplicateProject(named('x'.repeat(PROJECT_NAME_MAX)))

    // Act
    const twice = duplicateProject(once)

    // Assert
    expect(currentProject(twice).name.length).toBeLessThanOrEqual(PROJECT_NAME_MAX)
    expect(currentProject(twice).name.endsWith(COPY_SUFFIX)).toBe(true)
    expect(StoreSchema.safeParse(twice).success).toBe(true)
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

describe('renameProject', () => {
  test('trims the name and renames only that project', () => {
    const s = addProject(initialStore(), 'Second')
    const renamed = renameProject(s, 'p1', '  Garita  ', 'Untitled')
    expect(renamed.projects.find((p) => p.id === 'p1')?.name).toBe('Garita')
    expect(renamed.projects.find((p) => p.id !== 'p1')?.name).toBe('Second')
  })

  test('a blank name becomes the fallback', () => {
    expect(currentProject(renameProject(initialStore(), 'p1', '   ', 'Untitled')).name).toBe('Untitled')
  })

  test('cuts a long name to the stored limit', () => {
    expect(currentProject(renameProject(initialStore(), 'p1', 'x'.repeat(90), 'Untitled')).name).toHaveLength(PROJECT_NAME_MAX)
  })

  test('a name cut to the limit is the longest one the schema accepts', () => {
    // Arrange
    const cut = currentProject(renameProject(initialStore(), 'p1', 'x'.repeat(PROJECT_NAME_MAX * 2), 'Untitled'))
    const oneTooLong = { ...cut, name: `${cut.name}x` }

    // Act
    const [accepted, rejected] = [ProjectSchema.safeParse(cut), ProjectSchema.safeParse(oneTooLong)]

    // Assert
    expect(cut.name).toHaveLength(PROJECT_NAME_MAX)
    expect(accepted.success).toBe(true)
    expect(rejected.success).toBe(false)
  })

  test('an unchanged name or unknown id returns the same store', () => {
    const s = initialStore()
    expect(renameProject(s, 'p1', ' Home ', 'Untitled')).toBe(s)
    expect(renameProject(s, 'nope', 'X', 'Untitled')).toBe(s)
  })
})

describe('a copy that is not an account\'s, on its way into one', () => {
  test('an edited first project takes a new id and stays the open one', () => {
    const edited = patchCurrent(initialStore(), { hours: 24 })

    const rekeyed = rekeySeed(edited)

    expect(rekeyed.projects).toHaveLength(1)
    expect(rekeyed.projects[0]!.id).not.toBe('p1')
    expect(rekeyed.projects[0]).toEqual({ ...edited.projects[0]!, id: rekeyed.projects[0]!.id })
    expect(rekeyed.currentId).toBe(rekeyed.projects[0]!.id)
    expect(StoreSchema.safeParse(rekeyed).success).toBe(true)
  })

  test('a first project that was never edited takes a new id too, and keeps its stamp of 0', () => {
    // Under the id every browser starts with, an edit made before the account's list is read would be saved over
    // the account's own first project.
    const untouched = addProject(initialStore(), 'Office')

    const rekeyed = rekeySeed(untouched)

    expect(rekeyed.projects.map((p) => p.name)).toEqual(['Home', 'Office'])
    expect(rekeyed.projects[0]!.id).not.toBe('p1')
    expect(rekeyed.projects[0]!.updatedAt).toBe(0)
    expect(rekeyed.projects[1]).toBe(untouched.projects[1])
    expect(rekeySeed(initialStore()).projects[0]!.id).not.toBe(rekeySeed(initialStore()).projects[0]!.id)
  })

  test('another project being open stays open, and the others keep their ids', () => {
    const withOffice = addProject(initialStore(), 'Office')
    const office = currentProject(withOffice)
    const edited = selectProject(patchProject(withOffice, 'p1', { hours: 24 }), office.id)

    const rekeyed = rekeySeed(edited)

    expect(rekeyed.currentId).toBe(office.id)
    expect(rekeyed.projects.map((p) => p.name)).toEqual(['Home', 'Office'])
    expect(rekeyed.projects[0]!.id).not.toBe('p1')
    expect(rekeyed.projects[1]).toBe(edited.projects[1])
  })

  test('a store without the first project is returned as it is', () => {
    const onlyOffice = deleteProject(selectProject(addProject(initialStore(), 'Office'), 'p1'))

    expect(rekeySeed(onlyOffice)).toBe(onlyOffice)
  })
})

describe('work that was set aside, coming back to its account', () => {
  const clinic = { ...initialStore().projects[0]!, id: 'c1', name: 'Clinic', updatedAt: 5 }

  test('nothing set aside leaves the copy as it is', () => {
    const fresh = rekeySeed(initialStore())

    expect(withSetAside(fresh, [], false)).toBe(fresh)
  })

  test('on a copy that is not the account\'s, a first project nobody edited is left out and the open project is one that stays', () => {
    const fresh = rekeySeed(initialStore())

    const merged = withSetAside(fresh, [clinic], false)

    expect(merged.projects).toEqual([clinic])
    expect(merged.currentId).toBe('c1')
    expect(StoreSchema.safeParse(merged).success).toBe(true)
  })

  test('on a copy that is not the account\'s, work done signed out is kept beside what was set aside', () => {
    const signedOut = addProject(rekeySeed(patchCurrent(initialStore(), { name: 'Trial' })), 'Office')

    const merged = withSetAside(signedOut, [clinic], false)

    expect(merged.projects.map((p) => p.name)).toEqual(['Clinic', 'Trial', 'Office'])
    expect(merged.currentId).toBe(signedOut.currentId)
  })

  test('on the account\'s own copy every project stays, and of two copies of one the newer does', () => {
    const own = { version: 1 as const, currentId: 'c1', projects: [{ ...clinic, hours: 30, updatedAt: 9 }, { ...clinic, id: 'h1', name: 'Home', updatedAt: 0 }] }

    const merged = withSetAside(own, [{ ...clinic, hours: 24 }], true)

    expect(merged.projects.map((p) => [p.name, p.hours])).toEqual([['Clinic', 30], ['Home', 10]])
    expect(withSetAside({ ...own, projects: [{ ...clinic, hours: 30, updatedAt: 1 }] }, [{ ...clinic, hours: 24 }], true).projects[0]!.hours).toBe(24)
  })
})
