import { describe, expect, test } from 'vitest'
import { authBaseURL, authTrustedOrigins } from './auth-url'

describe('authBaseURL', () => {
  test('an explicit BETTER_AUTH_URL always wins', () => {
    expect(authBaseURL({ BETTER_AUTH_URL: 'https://solar.example', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'solar-dimension.vercel.app' })).toBe('https://solar.example')
  })

  test('production uses the stable production domain, not the per-deployment hostname', () => {
    expect(authBaseURL({
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'solar-dimension.vercel.app',
      VERCEL_URL: 'solar-dimension-abc123-yosonoronosoys-projects.vercel.app',
    })).toBe('https://solar-dimension.vercel.app')
  })

  test('previews use their own deployment hostname', () => {
    expect(authBaseURL({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'solar-dimension.vercel.app', VERCEL_URL: 'solar-dimension-git-x.vercel.app' }))
      .toBe('https://solar-dimension-git-x.vercel.app')
  })

  test('local development falls back to localhost', () => {
    expect(authBaseURL({})).toBe('http://localhost:3000')
  })
})

describe('authTrustedOrigins', () => {
  test("a preview also trusts its branch's own URL, which stays the same across redeploys", () => {
    expect(authTrustedOrigins({
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'solar-dimension-b2d1zsplh-yosonoronosoys-projects.vercel.app',
      VERCEL_BRANCH_URL: 'solar-dimension-git-claude-conti-22ca0d-yosonoronosoys-projects.vercel.app',
    })).toEqual(['https://solar-dimension-git-claude-conti-22ca0d-yosonoronosoys-projects.vercel.app'])
  })

  test('production and local development trust nothing beyond the base URL', () => {
    expect(authTrustedOrigins({ VERCEL_ENV: 'production', VERCEL_BRANCH_URL: 'solar-dimension-git-main-yosonoronosoys-projects.vercel.app' })).toEqual([])
    expect(authTrustedOrigins({})).toEqual([])
  })

  test('an explicit BETTER_AUTH_URL is the only origin, even on a preview', () => {
    expect(authTrustedOrigins({ BETTER_AUTH_URL: 'https://solar.example', VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'x-git-y.vercel.app' })).toEqual([])
  })
})
