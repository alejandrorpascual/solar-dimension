import { expect, test } from 'vitest'
import { addProject, currentProject, initialStore, patchCurrent } from './store'
import {
  adoptKept, adoptStale, applyChanges, clampStamp, diffProjects, editsOf, hasUnsent, importable, isForAccount, leftOut, MAX_CLOCK_LEAD_MS, mergeEdits, namedEdits,
  newestById, NOTHING_UNSENT, outgoing, parseNamed, readBack, rebase, unsentOf, type Edits, type StartedFrom,
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

test('rebase lays the fields edited here over the account copy, and takes a project added here whole', () => {
  const before = initialStore()
  const account = patchCurrent(before, { hours: 20, updatedAt: 5 }).projects
  // 24 V, not the 48 V a new project starts with: an edit to the value already there changes only the stamp.
  const after = addProject(patchCurrent(before, { volts: 24, updatedAt: 9 }), 'Office')

  const merged = rebase(account, before.projects, after.projects)

  expect(merged.map((p) => p.name)).toEqual(['Home', 'Office'])
  expect(merged[0]).toMatchObject({ hours: 20, volts: 24, updatedAt: 9 })
  expect(rebase([], before.projects, after.projects).map((p) => p.name)).toEqual(['Home', 'Office'])
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

test("adoptKept follows another tab's list, with the copy here of a project where it is stamped later", () => {
  const seed = initialStore().projects[0]!
  const here = [
    { ...seed, hours: 20, updatedAt: 30 },
    { ...seed, id: 'p2', name: 'Office', hours: 4, updatedAt: 10 },
    { ...seed, id: 'p3', name: 'Shed', updatedAt: 10 },
  ]
  const kept = [
    { ...seed, hours: 12, updatedAt: 20 },
    { ...seed, id: 'p2', name: 'Office', hours: 6, updatedAt: 40 },
    { ...seed, id: 'p4', name: 'Barn', hours: 3, updatedAt: 5 },
  ]

  expect(adoptKept(here, kept).map((p) => [p.name, p.hours])).toEqual([['Home', 20], ['Office', 6], ['Barn', 3]])
  // A tie goes to the kept copy, as the account takes the incoming copy on a tie.
  expect(adoptKept([{ ...seed, hours: 20, updatedAt: 30 }], [{ ...seed, hours: 12, updatedAt: 30 }])[0]!.hours).toBe(12)
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

test('an edit names the fields it changed with the values they had before it, and a project it added as all of it', () => {
  const before = addProject(initialStore(), 'Office').projects
  const after = [{ ...before[0]!, hours: 24, volts: 12 as const, updatedAt: 99 }, before[1]!, project('p-new')]

  expect(editsOf(before, diffProjects(before, after).upserts)).toEqual(new Map<string, unknown>([
    [before[0]!.id, { hours: before[0]!.hours, volts: before[0]!.volts }],
    ['p-new', 'all'],
  ]))
})

test('edits carried from a failed save keep the start of a field edited again, and a save names only those it sends', () => {
  const earlier: Edits = new Map<string, StartedFrom | 'all'>([['p1', { hours: 10 }], ['p2', 'all']])
  const later: Edits = new Map<string, StartedFrom | 'all'>([['p1', { hours: 15, volts: 48 }], ['p2', { name: 'Home' }], ['p3', { qty: {} }]])
  const merged = mergeEdits(earlier, later)

  expect(merged).toEqual(new Map<string, unknown>([['p1', { hours: 10, volts: 48 }], ['p2', 'all'], ['p3', { qty: {} }]]))
  expect(namedEdits([project('p1'), project('p2')], merged)).toEqual({ p1: { hours: 10, volts: 48 } })
})

test('a save names only fields a save can write, each starting value as its field holds it', () => {
  expect(parseNamed({ p1: { hours: 10, requester: null, qty: { fan: 2 } } })).toEqual({ p1: { hours: 10, requester: null, qty: { fan: 2 } } })
  expect(parseNamed(undefined)).toEqual({})
  expect(() => parseNamed({ p1: { updatedAt: 0 } })).toThrow('cannot name the field updatedAt')
  expect(() => parseNamed({ p1: { hours: 'ten' } })).toThrow()
})

test('a named save takes back only the fields the account kept at its own value, where the screen still shows what was sent', () => {
  const sent = { ...seed!, hours: 5, name: 'Renamed' }
  const account = { ...seed!, hours: 20, name: 'Renamed', volts: 12 as const }
  const named = { [seed!.id]: { hours: 10, name: seed!.name } }

  expect(adoptStale([sent], [sent], [account], named)).toEqual([{ ...sent, hours: 20 }])
  expect(adoptStale([{ ...sent, hours: 6 }], [sent], [account], named)).toEqual([{ ...sent, hours: 6 }])
})

test('a list read again keeps a copy this browser stamped later, and drops a project the account lacks unless a save is on its way', () => {
  const here = [{ ...project('p1', 24), updatedAt: 30 }, { ...project('p2'), updatedAt: 5 }, { ...project('p-added'), updatedAt: 40 }]
  const list = [{ ...project('p1', 10), updatedAt: 20 }, { ...project('p2', 6), updatedAt: 25 }]

  expect(readBack(here, list, false).map((p) => [p.id, p.hours])).toEqual([['p1', 24], ['p2', 6]])
  expect(readBack(here, list, true).map((p) => [p.id, p.hours])).toEqual([['p1', 24], ['p2', 6], ['p-added', 10]])
})
