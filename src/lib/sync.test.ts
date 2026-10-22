import { expect, test } from 'vitest'
import { addProject, currentProject, initialStore, patchCurrent } from './store'
import {
  adoptStale, applyChanges, clampStamp, diffProjects, hasUnsent, importable, isForAccount, leftOut, MAX_CLOCK_LEAD_MS, newestById, NOTHING_UNSENT, outgoing,
  unsentOf,
} from './sync'

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

test('newestById keeps one copy of each project, the one stamped latest', () => {
  const [home] = initialStore().projects
  const older = { ...home!, id: 'a', hours: 4, updatedAt: 10 }
  const newer = { ...home!, id: 'a', hours: 8, updatedAt: 20 }
  const other = { ...home!, id: 'b', updatedAt: 5 }

  expect(newestById([older, other, newer])).toEqual([newer, other])
  expect(newestById([newer, other, older])).toEqual([newer, other])
  expect(newestById([older, { ...older, hours: 6 }]).map((p) => p.hours)).toEqual([6])
  expect(newestById([])).toEqual([])
})

test('an import stores a never-edited first project only for an account that has no project yet', () => {
  const untouched = { ...seed!, updatedAt: 0 }
  const edited = { ...seed!, id: 'edited', updatedAt: 5 }

  expect(importable([untouched, edited], false)).toEqual([untouched, edited])
  expect(importable([untouched, edited], true)).toEqual([edited])
  expect(importable([untouched], true)).toEqual([])
})

test('a request acts on the signed-in account only from a page that was loaded for it', () => {
  expect(isForAccount('user-ana', 'user-ana')).toBe(true)
  // A tab left open for Ana, sending with the cookie of Bea, who signed in after her.
  expect(isForAccount('user-ana', 'user-bea')).toBe(false)
  // A page built before requests said which account they were for.
  expect(isForAccount(undefined, 'user-bea')).toBe(true)
})

test('a save leaves out the fields its build does not know, by project; a battery-only kit still carries its solar', () => {
  const home = currentProject(initialStore())
  // A build older than solar and duty overrides sends neither.
  const { solar: _solar, dutyOverrides: _duty, ...older } = { ...home, id: 'p-older' }

  expect(leftOut([older, { ...home, id: 'p-whole' }, { ...home, id: 'p-battery-only', solar: null }])).toEqual(new Map([
    ['p-older', ['solar', 'dutyOverrides']],
    ['p-whole', []],
    ['p-battery-only', []],
  ]))
})
