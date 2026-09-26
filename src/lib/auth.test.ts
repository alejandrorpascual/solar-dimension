import type { BetterAuthOptions } from 'better-auth'
import { expect, test, vi } from 'vitest'

vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test')
vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret-1234')
vi.stubEnv('GOOGLE_CLIENT_ID', 'e2e-google-client-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'e2e-google-client-secret')

test('auth is configured for email + password with TanStack cookies', async () => {
  const { auth } = await import('./auth')
  expect(auth.options.emailAndPassword?.enabled).toBe(true)
  expect(auth.options.plugins?.some((p) => p.id === 'tanstack-start-cookies' || p.id === 'tanstackStartCookies')).toBe(true)
})

test('Google is a social provider when configured, and is not trusted for implicit linking', async () => {
  const { auth } = await import('./auth')
  expect(auth.options.socialProviders?.google?.clientId).toBe('e2e-google-client-id')
  const linking = (auth.options as BetterAuthOptions).account?.accountLinking
  expect(Array.isArray(linking?.trustedProviders) ? linking.trustedProviders : []).not.toContain('google')
  expect(linking?.requireLocalEmailVerified ?? true).toBe(true)
})
