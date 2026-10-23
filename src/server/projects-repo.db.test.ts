// Runs only with `npm run test:db`, on the test database (vitest.db.setup.ts refuses any other). Each run saves under
// account ids of its own and deletes their rows at the end, as CI runs of other branches share that database.
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { projects } from '../db/schema'
import { ProjectSchema, type Project } from '../lib/schema'
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

    await saveForUser(userId, [volts], new Map(), { [start.id]: { volts: start.volts } })
    const answer = await saveForUser(userId, [hours], new Map(), { [start.id]: { hours: start.hours } })

    expect(answer).toEqual({ ok: true, stale: [] })
    expect((await listForUser(userId)).find((p) => p.id === start.id)).toEqual({ ...start, volts: 12, hours: 24, updatedAt: LATER })
  })

  it('keeps the later edit of one field and answers the older one with the account copy', async () => {
    const start = project('Home', EARLIER - 1)
    await saveForUser(userId, [start])
    const later = { ...start, qty: { fridge: 2 }, updatedAt: LATER }
    const earlier = { ...start, qty: { fan: 1 }, updatedAt: EARLIER }

    await saveForUser(userId, [later], new Map(), { [start.id]: { qty: start.qty } })
    const answer = await saveForUser(userId, [earlier], new Map(), { [start.id]: { qty: start.qty } })

    expect(answer).toEqual({ ok: true, stale: [later] })
    expect((await listForUser(userId)).find((p) => p.id === start.id)).toEqual(later)
  })

  it('writes a named field that started from null, and inserts whole a named project the account lacks', async () => {
    const start = project('Home', EARLIER)
    const requester = { ...emptyRequester('US'), name: 'Ana Lopez', docPrefix: '', doc: '' }
    const added = { ...start, requester, updatedAt: LATER }

    const answer = await saveForUser(userId, [added], new Map(), { [start.id]: { requester: null } })
    await saveForUser(userId, [{ ...added, hours: 7 }], new Map(), { [start.id]: { hours: start.hours } })

    expect(answer).toEqual({ ok: true, stale: [] })
    expect((await listForUser(userId)).find((p) => p.id === start.id)).toMatchObject({ requester, hours: 7 })
  })
})

