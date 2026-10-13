import { expect, test } from 'vitest'
import { addProject, currentProject, initialStore, patchCurrent } from './store'
import { adoptStale, applyChanges, clampStamp, diffProjects, hasUnsent, MAX_CLOCK_LEAD_MS, NOTHING_UNSENT, outgoing, unsentOf } from './sync'

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

test('a changed requester makes the project an upsert', () => {
  const before = initialStore().projects
  const requester = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '', email: '', address: '' } as const
  const after = patchCurrent(initialStore(), { requester }).projects
  expect(diffProjects(before, after).upserts.map((p) => p.id)).toEqual([before[0]!.id])
})

test('clampStamp keeps a stamp the device could honestly have written', () => {
  const now = 1_790_000_000_000

  expect(clampStamp(now - 5_000, now)).toBe(now - 5_000)
  expect(clampStamp(0, now)).toBe(0)
  expect(clampStamp(now + 2_000, now)).toBe(now + 2_000)
  expect(clampStamp(now + MAX_CLOCK_LEAD_MS, now)).toBe(now + MAX_CLOCK_LEAD_MS)
})

test('clampStamp replaces a stamp from a clock that runs far ahead with the server time', () => {
  const now = 1_790_000_000_000

  expect(clampStamp(now + MAX_CLOCK_LEAD_MS + 1, now)).toBe(now)
  expect(clampStamp(now + 3_600_000, now)).toBe(now)
})

test('adoptStale takes the newer copy of a project that was not edited since it was sent', () => {
  const sent = addProject(initialStore(), 'Office').projects
  const newer = { ...sent[1]!, hours: 20, updatedAt: sent[1]!.updatedAt + 1 }

  const adopted = adoptStale(sent, sent, [newer])

  expect(adopted.map((p) => p.hours)).toEqual([sent[0]!.hours, 20])
  expect(adopted[0]).toBe(sent[0])
})

test('adoptStale leaves a project edited again since it was sent, and one that was not sent', () => {
  const sent = addProject(initialStore(), 'Office').projects
  const editedSince = sent.map((p) => (p.name === 'Office' ? { ...p, hours: 6 } : p))
  const newerOffice = { ...sent[1]!, hours: 20 }
  const newerHome = { ...sent[0]!, hours: 30 }

  expect(adoptStale(editedSince, sent, [newerOffice]).map((p) => p.hours)).toEqual([sent[0]!.hours, 6])
  expect(adoptStale(sent, [sent[1]!], [newerHome])).toEqual(sent)
  expect(adoptStale(sent, sent, [])).toEqual(sent)
})

const [seed] = initialStore().projects
const project = (id: string, hours = 10) => ({ ...seed!, id, hours })
const ids = (list: readonly { id: string }[]) => list.map((p) => p.id)

test('a save with nothing unsent before it sends its own change and nothing else', () => {
  const next = [project('a'), project('b', 24), project('c')]

  const sent = outgoing(next, { upserts: [next[1]!], deletes: ['gone'] }, NOTHING_UNSENT)

  expect(sent).toEqual({ upserts: [next[1]], deletes: ['gone'] })
})

test('a save carries what failed before it, as each project stands now', () => {
  const next = [project('a', 12), project('b', 24), project('c')]
  const failedBefore = { upserts: new Set(['a']), deletes: new Set(['old']) }

  const sent = outgoing(next, { upserts: [next[1]!], deletes: [] }, failedBefore)

  expect(sent.upserts).toEqual([next[0], next[1]])
  expect(sent.deletes).toEqual(['old'])
})

test('a project whose edit failed and that was deleted since is only deleted, once', () => {
  const next = [project('a')]
  const failedBefore = { upserts: new Set(['b']), deletes: new Set(['b']) }

  const sent = outgoing(next, { upserts: [], deletes: ['b'] }, failedBefore)

  expect(sent).toEqual({ upserts: [], deletes: ['b'] })
})

test('a save that failed is what the next one must carry', () => {
  const failed = unsentOf({ upserts: [project('a'), project('b')], deletes: ['c'] })

  expect([...failed.upserts]).toEqual(['a', 'b'])
  expect([...failed.deletes]).toEqual(['c'])
  expect(hasUnsent(failed)).toBe(true)
  expect(hasUnsent(unsentOf({ upserts: [], deletes: ['c'] }))).toBe(true)
  expect(hasUnsent(NOTHING_UNSENT)).toBe(false)
  expect(ids(outgoing([project('a'), project('b')], { upserts: [], deletes: [] }, failed).upserts)).toEqual(['a', 'b'])
})
