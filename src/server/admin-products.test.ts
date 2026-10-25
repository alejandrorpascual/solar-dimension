import { beforeEach, expect, test, vi } from 'vitest'

const ADMIN_EMAIL = 'owner@example.com'
const PRODUCT_ID = '6f1d2c3b-0000-4000-8000-000000000001'
const SEEN = '2026-10-25T12:00:00.000Z'

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
// admin-catalog's own repo; nothing here reads it.
vi.mock('./catalog-repo', () => ({}))
vi.mock('./product-repo', () => ({ listProductsForAdmin: vi.fn(async () => [{ id: PRODUCT_ID }]), verifyProduct: vi.fn(async () => true) }))

const { auth } = await import('../lib/auth')
const { listProductsForAdmin, verifyProduct } = await import('./product-repo')
const { adminListProducts, adminVerifyProduct } = await import('./admin-products')

const signedInAs = (email: string, emailVerified = true) =>
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: 'admin-1', email, emailVerified } } as never)
const verify = (data: unknown) => (adminVerifyProduct as unknown as (a: { data: unknown }) => Promise<unknown>)({ data })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ADMIN_EMAILS', ADMIN_EMAIL)
})

test.each([
  ['signed out', () => vi.mocked(auth.api.getSession).mockResolvedValue(null as never)],
  ['signed in, not an admin', () => signedInAs('someone@example.com')],
  ['the admin email, not verified', () => signedInAs(ADMIN_EMAIL, false)],
])('listing and verifying products are "Not found" when %s, and touch nothing', async (_, session) => {
  session()

  await expect(adminListProducts()).rejects.toThrow('Not found')
  await expect(verify({ id: PRODUCT_ID, seenUpdatedAt: SEEN })).rejects.toThrow('Not found')
  expect(listProductsForAdmin).not.toHaveBeenCalled()
  expect(verifyProduct).not.toHaveBeenCalled()
})

test('the admin verifies a product as themselves, against the version they read', async () => {
  signedInAs(ADMIN_EMAIL)

  expect(await verify({ id: PRODUCT_ID, seenUpdatedAt: SEEN })).toEqual({ ok: true })
  expect(verifyProduct).toHaveBeenCalledWith(PRODUCT_ID, SEEN, 'admin-1')
})

test('verifying a product changed since the admin read it says to reload', async () => {
  signedInAs(ADMIN_EMAIL)
  vi.mocked(verifyProduct).mockResolvedValueOnce(false)

  await expect(verify({ id: PRODUCT_ID, seenUpdatedAt: SEEN })).rejects.toThrow('changed since this page loaded')
})

test.each([
  ['no version read', { id: PRODUCT_ID }],
  ['an id that is not a uuid', { id: 'kettle', seenUpdatedAt: SEEN }],
  ['who verified it', { id: PRODUCT_ID, seenUpdatedAt: SEEN, actor: 'someone-else' }],
])('refuses a verify with %s before writing', async (_, data) => {
  signedInAs(ADMIN_EMAIL)

  await expect(verify(data)).rejects.toThrow()
  expect(verifyProduct).not.toHaveBeenCalled()
})

test('the admin gets the products', async () => {
  signedInAs(ADMIN_EMAIL)

  expect(await adminListProducts()).toEqual([{ id: PRODUCT_ID }])
})
