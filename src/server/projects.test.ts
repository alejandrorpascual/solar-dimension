// The save and import server functions, from the request the page sends to the call that writes the account's rows: a
// project the request carries without a field must reach the write as left out, so the account keeps its own value.
import { beforeEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import type { Project } from '../lib/schema'
import { currentProject, initialStore } from '../lib/store'
import { importProjects, saveProjects } from './projects'
import { listForUser, saveForUser, upsertAll } from './projects-repo'

const ANA = 'user-ana'

/**
 * A server function as it runs on the server: its validator gets the payload as the request carried it, and the handler
 * gets what the validator returned (start-client-core createServerFn, `env === "server"`).
 */
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (data: unknown): unknown => data
    const fn = {
      validator: (v: (data: unknown) => unknown) => { validate = v; return fn },
      handler: (h: (ctx: { data: unknown }) => unknown) => async ({ data }: { data: unknown }) => h({ data: validate(data) }),
    }
    return fn
  },
}))
vi.mock('./session', () => ({ AccountClaim: z.string().min(1).optional(), requireAccount: async () => ANA }))
vi.mock('./projects-repo', () => ({
  listForUser: vi.fn(async () => []),
  saveForUser: vi.fn(async () => ({ ok: true, stale: [] })),
  upsertAll: vi.fn(async () => new Set<string>()),
}))
/** The account already holds a project: an import then writes only the projects edited on the device. */
vi.mock('../db/client', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'stored' }] }) }) }) },
}))
vi.mock('./quotes/deps', () => ({}))
vi.mock('./quotes/limits', () => ({}))
vi.mock('./quotes/repo', () => ({}))

const home: Project = { ...currentProject(initialStore()), updatedAt: 1_000 }
/** As a build older than solar sends it: no `solar` key at all. */
const { solar: _solar, ...withoutSolar } = { ...home, id: 'p-older' }
/** A battery-only kit from this build: it sends `solar: null`, which is a value to write. */
const batteryOnly = { ...home, id: 'p-battery-only', solar: null }

beforeEach(() => { vi.clearAllMocks() })

test('a save that carries a project without solar asks the write to keep the stored solar, and writes a sent null', async () => {
  await saveProjects({ data: { account: ANA, projects: [withoutSolar, batteryOnly] } })

  expect(saveForUser).toHaveBeenCalledTimes(1)
  const [userId, saved, leftOut] = vi.mocked(saveForUser).mock.calls[0]!
  expect(userId).toBe(ANA)
  expect(saved.map((p) => [p.id, p.solar])).toEqual([['p-older', null], ['p-battery-only', null]])
  expect(leftOut).toEqual(new Map([['p-older', ['solar']], ['p-battery-only', []]]))
})

test('an import that carries a project without solar asks the write to keep the stored solar', async () => {
  await importProjects({ data: { account: ANA, projects: [withoutSolar] } })

  expect(upsertAll).toHaveBeenCalledTimes(1)
  const [userId, written, leftOut] = vi.mocked(upsertAll).mock.calls[0]!
  expect(userId).toBe(ANA)
  expect(written.map((p) => p.id)).toEqual(['p-older'])
  expect(leftOut).toEqual(new Map([['p-older', ['solar']]]))
  expect(listForUser).toHaveBeenCalledWith(ANA)
})

test('a save that names fields passes them to the write, and a field no save can name is refused', async () => {
  await saveProjects({ data: { account: ANA, projects: [home], named: { [home.id]: { hours: 20, requester: 30 } } } })

  const [, , , named] = vi.mocked(saveForUser).mock.calls[0]!
  expect(named).toEqual({ [home.id]: { hours: 20, requester: 30 } })
  await expect(saveProjects({ data: { account: ANA, projects: [home], named: { [home.id]: { id: 20 } } } })).rejects.toThrow('cannot name the field id')
})
