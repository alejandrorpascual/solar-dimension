import { expect, test, vi } from 'vitest'

vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test')
vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret-1234')

test('auth is configured for email + password with TanStack cookies', async () => {
  const { auth } = await import('./auth')
  expect(auth.options.emailAndPassword?.enabled).toBe(true)
  expect(auth.options.plugins?.some((p) => p.id === 'tanstack-start-cookies' || p.id === 'tanstackStartCookies')).toBe(true)
})
