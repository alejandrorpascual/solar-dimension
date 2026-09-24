import { expect, test } from 'vitest'
import { addProject, currentProject, initialStore, patchCurrent } from './store'
import { diffProjects } from './sync'

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
