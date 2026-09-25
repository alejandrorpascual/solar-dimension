import { describe, expect, test } from 'vitest'
import { authBaseURL } from './auth-url'

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
