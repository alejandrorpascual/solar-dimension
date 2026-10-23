// Runs only with `npm run test:db`, on the test database (vitest.db.setup.ts refuses any other). Each run saves under
// account ids of its own and deletes their rows at the end, as CI runs of other branches share that database.
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { projects } from '../db/schema'
import { DEFAULT_ELECTRICAL, ProjectSchema, type Project } from '../lib/schema'
import { currentProject, initialStore } from '../lib/store'
import { emptyRequester } from '../lib/requester'
import { leftOut } from '../lib/sync'
import { listForUser, saveForUser } from './projects-repo'

const userId = `test-db-${randomUUID()}`
const otherUserId = `test-db-${randomUUID()}`
const EARLIER = Date.UTC(2026, 0, 1, 9)
const LATER = Date.UTC(2026, 0, 1, 10)

let nextId = 0
/** A project as the account reads it back: parsed, so every field the schema fills in is already there. */
function project(name: string, updatedAt: number): Project {
  return ProjectSchema.parse({ ...currentProject(initialStore()), id: `p-${++nextId}`, name, updatedAt })
}

/** The account's copy of a project, as a device reads it. */
const stored = async (id: string) => (await listForUser(userId)).find((p) => p.id === id)!

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.userId, [userId, otherUserId]))
})

describe('saveForUser on the test database', () => {
  it('keeps the newer edit when an older copy arrives, and answers with it in stale', async () => {
    const newer = project('Newer edit', LATER)
    const older = { ...newer, name: 'Older edit', updatedAt: EARLIER }

    expect(await saveForUser(userId, [newer])).toEqual({ ok: true, stale: [] })
    const answer = await saveForUser(userId, [older])

    expect(answer).toEqual({ ok: true, stale: [newer] })
    expect((await listForUser(userId)).find((p) => p.id === newer.id)).toEqual(newer)
  })

  it('stores a newer edit over the older one, with nothing in stale', async () => {
    const older = project('Older edit', EARLIER)
    const newer = { ...older, name: 'Newer edit', updatedAt: LATER }

    await saveForUser(userId, [older])
    const answer = await saveForUser(userId, [newer])

    expect(answer).toEqual({ ok: true, stale: [] })
    expect((await listForUser(userId)).find((p) => p.id === older.id)).toEqual(newer)
  })

  it("answers with this account's copy only, when another account has a project with the same id", async () => {
    const ours = project('Our newer edit', LATER)
    const theirs = { ...ours, name: 'Their project' }
    await saveForUser(otherUserId, [theirs])
    await saveForUser(userId, [ours])

    const answer = await saveForUser(userId, [{ ...ours, name: 'Our older edit', updatedAt: EARLIER }])

    expect(answer).toEqual({ ok: true, stale: [ours] })
    expect(await listForUser(otherUserId)).toEqual([theirs])
  })

  it('keeps the stored solar settings when a save leaves the solar field out, and writes the fields it carries', async () => {
    const withPanels: Project = { ...project('With panels', EARLIER), solar: { roofM2: 40, panels: 6, sunHours: 5 } }
    await saveForUser(userId, [withPanels])
    // A build older than solar: it sends the project without the field, and the schema reads it as battery-only.
    const { solar: _solar, ...sent } = { ...withPanels, hours: 12, updatedAt: LATER }

    const answer = await saveForUser(userId, [ProjectSchema.parse(sent)], leftOut([sent]))

    expect(answer).toEqual({ ok: true, stale: [] })
    expect((await listForUser(userId)).find((p) => p.id === withPanels.id)).toEqual({ ...withPanels, hours: 12, updatedAt: LATER })
  })

  it('keeps both edits when two saves name different fields and the older one arrives last', async () => {
    const start = project('Home', EARLIER - 1)
    await saveForUser(userId, [start])
    const volts = { ...start, volts: 12 as const, updatedAt: LATER }
    const hours = { ...start, hours: 24, updatedAt: EARLIER }

    await saveForUser(userId, [volts], new Map(), { [start.id]: ['volts'] })
    const answer = await saveForUser(userId, [hours], new Map(), { [start.id]: ['hours'] })

    expect(answer).toEqual({ ok: true, stale: [] })
    expect((await listForUser(userId)).find((p) => p.id === start.id)).toEqual({ ...start, volts: 12, hours: 24, updatedAt: LATER })
  })

  it('keeps the later edit of one field and answers the older one with the account copy', async () => {
    const start = project('Home', EARLIER - 1)
    await saveForUser(userId, [start])
    const later = { ...start, qty: { fridge: 2 }, updatedAt: LATER }
    const earlier = { ...start, qty: { fan: 1 }, updatedAt: EARLIER }

    await saveForUser(userId, [later], new Map(), { [start.id]: ['qty'] })
    const answer = await saveForUser(userId, [earlier], new Map(), { [start.id]: ['qty'] })

    expect(answer).toEqual({ ok: true, stale: [later] })
    expect((await listForUser(userId)).find((p) => p.id === start.id)).toEqual(later)
  })

  it('inserts whole a named project the account lacks, and writes a named field over a stored null', async () => {
    const start = project('Home', EARLIER)
    const requester = { ...emptyRequester('US'), name: 'Ana Lopez', docPrefix: '', doc: '' }

    const inserted = await saveForUser(userId, [{ ...start, hours: 7 }], new Map(), { [start.id]: ['hours'] })
    const answer = await saveForUser(userId, [{ ...start, hours: 7, requester, updatedAt: LATER }], new Map(), { [start.id]: ['requester'] })

    expect([inserted, answer]).toEqual([{ ok: true, stale: [] }, { ok: true, stale: [] }])
    expect(await stored(start.id)).toEqual({ ...start, hours: 7, requester, updatedAt: LATER })
  })

  it('keeps an older edit to the electrical settings of a project stored before them, when a later save of its hours lands first', async () => {
    const seed = project('Stored before the checks', EARLIER - 1)
    // As migration 0011 left every project saved before it: the electrical settings stored as `{}`, read as the defaults.
    await db.insert(projects).values({ ...seed, userId, electrical: {}, updatedAt: new Date(seed.updatedAt) })
    const read = await stored(seed.id)
    expect(read.electrical).toEqual(DEFAULT_ELECTRICAL)

    await saveForUser(userId, [{ ...read, hours: 24, updatedAt: LATER }], new Map(), { [read.id]: ['hours'] })
    const ambient = { ...read, electrical: { ...read.electrical, ambientC: 40 as const }, updatedAt: EARLIER }
    const answer = await saveForUser(userId, [ambient], new Map(), { [read.id]: ['electrical'] })

    expect(answer).toEqual({ ok: true, stale: [] })
    expect(await stored(read.id)).toEqual({ ...read, hours: 24, electrical: ambient.electrical, updatedAt: LATER })
  })

  it('keeps the later of two edits to one field when it sets the field back to where the older edit started', async () => {
    const start = project('Home', EARLIER - 2)
    await saveForUser(userId, [start])
    const deviceB = (hours: number, updatedAt: number) => saveForUser(userId, [{ ...start, hours, updatedAt }], new Map(), { [start.id]: ['hours'] })
    await deviceB(12, LATER)
    await deviceB(start.hours, LATER + 1)

    const answer = await saveForUser(userId, [{ ...start, hours: 5, updatedAt: EARLIER }], new Map(), { [start.id]: ['hours'] })

    expect(answer).toEqual({ ok: true, stale: [{ ...start, updatedAt: LATER + 1 }] })
    expect(await stored(start.id)).toEqual({ ...start, updatedAt: LATER + 1 })
  })

  it('of two edits to one field stamped at the same moment, keeps the one that arrives last', async () => {
    const start = project('Home', EARLIER)
    await saveForUser(userId, [start])
    const first = { ...start, hours: 12, updatedAt: LATER }
    const last = { ...start, hours: 20, updatedAt: LATER }

    await saveForUser(userId, [first], new Map(), { [start.id]: ['hours'] })
    const answer = await saveForUser(userId, [last], new Map(), { [start.id]: ['hours'] })

    expect(answer).toEqual({ ok: true, stale: [] })
    expect(await stored(start.id)).toEqual(last)
  })

  it('answers a named save of appliance counts as written, though the account stores their keys in another order', async () => {
    const start = project('Two loads', EARLIER)
    await saveForUser(userId, [start])
    // jsonb keeps an object's keys shortest first: this is stored as {"tv": 1, "fridge": 2}.
    const counts = { ...start, qty: { fridge: 2, tv: 1 }, updatedAt: LATER }

    const answer = await saveForUser(userId, [counts], new Map(), { [start.id]: ['qty'] })

    expect(answer).toEqual({ ok: true, stale: [] })
    expect((await stored(start.id)).qty).toEqual(counts.qty)
  })

  it('keeps the stamp of a field a whole save left out, so an edit to it made after its last write still lands', async () => {
    const start: Project = { ...project('Home', EARLIER), solar: { roofM2: 40, panels: 6, sunHours: 5 } }
    await saveForUser(userId, [start])
    await saveForUser(userId, [{ ...start, solar: { ...start.solar!, panels: 8 }, updatedAt: EARLIER + 1 }], new Map(), { [start.id]: ['solar'] })
    // A build older than solar saves the project whole without it; an edit to solar made before that save lands after.
    const { solar: _solar, ...older } = { ...start, hours: 12, updatedAt: LATER }
    await saveForUser(userId, [ProjectSchema.parse(older)], leftOut([older]))
    const answer = await saveForUser(userId, [{ ...start, solar: { ...start.solar!, panels: 4 }, updatedAt: EARLIER + 2 }], new Map(), { [start.id]: ['solar'] })

    expect(answer).toEqual({ ok: true, stale: [] })
    expect(await stored(start.id)).toMatchObject({ hours: 12, solar: { panels: 4 }, updatedAt: LATER })
  })
})
