import { beforeEach, expect, test, vi } from 'vitest'

const ADMIN_EMAIL = 'owner@example.com'

// The server-function wrappers only route a call to its handler; here a call runs the handler directly.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = { validator: () => builder, handler: (fn: unknown) => fn }
    return builder
  },
  createServerOnlyFn: (fn: unknown) => fn,
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('../lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('./catalog-repo', () => ({ recentChanges: vi.fn(async () => [{ id: 1 }]) }))

const { auth } = await import('../lib/auth')
const { recentChanges } = await import('./catalog-repo')
const { adminRecentChanges } = await import('./admin-catalog')

const signedInAs = (email: string, emailVerified = true) =>
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'u1', email, emailVerified } } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ADMIN_EMAILS', ADMIN_EMAIL)
})

test.each([
  ['signed out', () => vi.mocked(auth.api.getSession).mockResolvedValue(null as never)],
  ['signed in, not an admin', () => signedInAs('someone@example.com')],
  ['the admin email, not verified', () => signedInAs(ADMIN_EMAIL, false)],
])('the change log, with the emails in it, is "Not found" when %s, and is never read', async (_, session) => {
  session()

  await expect(adminRecentChanges()).rejects.toThrow('Not found')
  expect(recentChanges).not.toHaveBeenCalled()
})

test('the admin gets the change log', async () => {
  signedInAs(ADMIN_EMAIL)

  expect(await adminRecentChanges()).toEqual([{ id: 1 }])
})
