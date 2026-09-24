import { expect, test } from 'vitest'
import { addProject, currentProject, initialStore, patchCurrent } from './store'
import { applyChanges, diffProjects } from './sync'

test('reports new and changed projects as upserts and missing ones as deletes', () => {
  const a = initialStore()
  const b = patchCurrent(addProject(a, 'Office'), { hours: 24 })
  const d = diffProjects(a.projects, b.projects)
  expect(d.upserts.map((p) => p.name)).toEqual(['Office'])
  expect(d.deletes).toEqual([])
  const c = { ...b, projects: b.projects.filter((p) => p.id !== 'p1') }
  expect(diffProjects(b.projects, c.projects)).toEqual({ upserts: [], deletes: ['p1'] })
  expect(diffProjects(b.projects, b.projects)).toEqual({ upserts: [], deletes: [] })
  expect(currentProject(b).hours).toBe(24)
})

test('applyChanges overlays local edits on a server list', () => {
  const server = initialStore().projects
  const local = patchCurrent(addProject(initialStore(), 'Office'), { hours: 24 })
  const merged = applyChanges(server, diffProjects(server, local.projects))
  expect(merged.map((p) => p.name)).toEqual(['Home', 'Office'])
  expect(merged[1]?.hours).toBe(24)
  const renamed = patchCurrent({ ...local, currentId: 'p1' }, { name: 'Casa' })
  const merged2 = applyChanges(server, diffProjects(server, renamed.projects))
  expect(merged2.map((p) => p.name)).toEqual(['Casa', 'Office'])
  const deleted = applyChanges(server, { upserts: [], deletes: ['p1'] })
  expect(deleted).toEqual([])
  expect(applyChanges(server, { upserts: [], deletes: [] })).toEqual(server)
})
