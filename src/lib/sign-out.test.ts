import { afterEach, expect, test, vi } from 'vitest'
import { signOutOfBrowser } from './sign-out'

afterEach(() => { vi.restoreAllMocks() })

/** The steps of a sign-out, recording the order they ran in. */
function steps(signOut: () => Promise<{ error: unknown }>) {
  const ran: string[] = []
  return {
    ran,
    signOut: () => { ran.push('signOut'); return signOut() },
    release: () => { ran.push('release') },
    reload: async () => { ran.push('reload') },
  }
}

test("once the session has ended, the account's projects leave the browser before the page loads again", async () => {
  const page = steps(async () => ({ error: null }))

  expect(await signOutOfBrowser(page)).toBe(true)

  expect(page.ran).toEqual(['signOut', 'release', 'reload'])
})

test('a sign-out the server refused leaves the projects where they are: the account is still signed in', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const page = steps(async () => ({ error: { status: 500, statusText: 'Internal Server Error' } }))

  expect(await signOutOfBrowser(page)).toBe(false)

  expect(page.ran).toEqual(['signOut'])
  expect(logged).toHaveBeenCalledWith('[auth] signing out failed', expect.anything())
})

test('a sign-out that got no answer is a failed one, not an unhandled error', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const offline = steps(() => Promise.reject(new TypeError('Failed to fetch')))

  expect(await signOutOfBrowser(offline)).toBe(false)

  expect(offline.ran).toEqual(['signOut'])
  expect(logged).toHaveBeenCalledWith('[auth] signing out failed', { error: expect.any(TypeError) })
})
