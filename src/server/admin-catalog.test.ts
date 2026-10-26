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
vi.mock('./catalog-repo', () => ({ recentChanges: vi.fn(async () => [{ id: 1 }]), revertChange: vi.fn(async () => 'reverted') }))

const { auth } = await import('../lib/auth')
const { recentChanges, revertChange } = await import('./catalog-repo')
const { adminRecentChanges, adminRevertChange } = await import('./admin-catalog')

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
  await expect(revert({ data: { changeId: 1 } })).rejects.toThrow('Not found')
  expect(revertChange).not.toHaveBeenCalled()
})

test('the admin gets the change log', async () => {
  signedInAs(ADMIN_EMAIL)

  expect(await adminRecentChanges()).toEqual([{ id: 1 }])
})

/** Handlers take the call's `{ data }`; the mock above hands the handler over unwrapped. */
const revert = adminRevertChange as unknown as (call: { data: unknown }) => Promise<unknown>

test('the admin reverts a change, as themselves', async () => {
  signedInAs(ADMIN_EMAIL)

  expect(await revert({ data: { changeId: 7 } })).toEqual({ ok: true })
  expect(revertChange).toHaveBeenCalledWith(7, 'u1')
})

test.each([
  ['not-found', 'Not found'],
  ['created', 'This change created the appliance, so there is nothing before it to put back. Retire it instead.'],
  ['invalid', 'The values before this change fail the catalog checks, so they cannot be put back.'],
  ['unchanged', 'The appliance already has the values from before this change.'],
] as const)('a revert that comes back %s tells the admin why nothing was written', async (outcome, message) => {
  signedInAs(ADMIN_EMAIL)
  vi.mocked(revertChange).mockResolvedValueOnce(outcome)

  await expect(revert({ data: { changeId: 7 } })).rejects.toThrow(message)
})

test('a change id that is not a positive whole number is refused before anything is read', async () => {
  signedInAs(ADMIN_EMAIL)

  await expect(revert({ data: { changeId: '7' } })).rejects.toThrow()
  await expect(revert({ data: { changeId: 0 } })).rejects.toThrow()
  expect(revertChange).not.toHaveBeenCalled()
})
