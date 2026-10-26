// Runs only with `npm run test:db`, on the test database (vitest.db.setup.ts refuses any other). Each run saves under
// account ids of its own and deletes their rows at the end, as CI runs of other branches share that database.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { user } from '../../db/auth-schema'
import { db } from '../../db/client'
import { projects, quotes } from '../../db/schema'
import { MAX_DAILY_READS } from '../../lib/quote-budget'
import { ProjectSchema } from '../../lib/schema'
import { currentProject, initialStore } from '../../lib/store'
import { saveForUser } from '../projects-repo'
import type { NewQuote } from './limits'

const userId = `test-db-${randomUUID()}`
const FILE = 'a'.repeat(64)

let limits: typeof import('./limits')
beforeAll(async () => {
  // Every run on this database shares today's read counter: a budget no run can spend, read when limits.ts loads.
  vi.stubEnv('QUOTES_DAILY_READS', String(MAX_DAILY_READS))
  limits = await import('./limits')
  // quote_usage belongs to an account, so this one is a real user row; deleting it takes its usage with it.
  await db.insert(user).values({ id: userId, name: 'test-db', email: `${userId}@test-db.invalid` })
  const project = (id: string) => ProjectSchema.parse({ ...currentProject(initialStore()), id, name: id, updatedAt: Date.now() })
  await saveForUser(userId, [project('first'), project('second')])
})

afterAll(async () => {
  await db.delete(projects).where(eq(projects.userId, userId))
  await db.delete(user).where(eq(user.id, userId))
  vi.unstubAllEnvs()
})

const quote = (projectId: string, fileName: string, fileHash = FILE): NewQuote => ({
  id: randomUUID(), userId, projectId, fileName, blobPathname: `test-db/${fileName}`, mime: 'application/pdf', sizeBytes: 1000, pages: 1, fileHash,
})
const rowExists = async (id: string) => (await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, id))).length > 0
const uploadsThisMonth = async () => (await limits.quoteCounts(userId, 'first')).month

describe('insertWithinLimits on the test database (#208)', () => {
  it('refuses a second quote of the same file in the same project, without counting it, and names the earlier one', async () => {
    const first = quote('first', 'solartec.pdf')
    expect(await limits.insertWithinLimits(first)).toBe(true)
    const counted = await uploadsThisMonth()

    const again = quote('first', 'voltia.pdf')
    expect(await limits.insertWithinLimits(again)).toBe(false)

    expect(await rowExists(again.id)).toBe(false)
    expect(await uploadsThisMonth()).toBe(counted)
    expect(await limits.quoteWithFile(userId, 'first', FILE)).toEqual({ fileName: 'solartec.pdf' })
  })

  it('accepts the same file in another project, and another file in the same project', async () => {
    expect(await limits.insertWithinLimits(quote('second', 'solartec.pdf'))).toBe(true)
    expect(await limits.insertWithinLimits(quote('first', 'grupoluz.pdf', 'b'.repeat(64)))).toBe(true)
  })

  it('accepts the file again once its quote was deleted', async () => {
    const other = 'c'.repeat(64)
    const first = quote('first', 'enerhogar.pdf', other)
    expect(await limits.insertWithinLimits(first)).toBe(true)
    await db.delete(quotes).where(and(eq(quotes.userId, userId), eq(quotes.id, first.id)))

    expect(await limits.quoteWithFile(userId, 'first', other)).toBeNull()
    expect(await limits.insertWithinLimits(quote('first', 'enerhogar.pdf', other))).toBe(true)
  })

  // QA v5: the insert alone holds when uploads of one file all pass the check before it, as parallel ones can.
  it('takes exactly one of several inserts of the same file sent at once, and counts it once', async () => {
    const same = 'd'.repeat(64)
    const before = await uploadsThisMonth()
    const sent = ['one', 'two', 'three', 'four'].map((n) => quote('first', `${n}.pdf`, same))

    const taken = await Promise.all(sent.map((q) => limits.insertWithinLimits(q)))

    expect(taken.filter(Boolean)).toHaveLength(1)
    const rows = await db.select({ id: quotes.id }).from(quotes).where(and(eq(quotes.userId, userId), eq(quotes.fileHash, same)))
    expect(rows).toHaveLength(1)
    expect(await uploadsThisMonth()).toBe(before + 1)
  })
})
