type AuthEnv = Partial<Record<'BETTER_AUTH_URL' | 'VERCEL_ENV' | 'VERCEL_PROJECT_PRODUCTION_URL' | 'VERCEL_URL', string>>

/**
 * The origin Better Auth trusts and builds callback URLs from. Production must use the stable domain: VERCEL_URL
 * is the per-deployment hostname, so requests from the real domain would fail the origin check (403).
 */
export function authBaseURL(env: AuthEnv): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`
  return 'http://localhost:3000'
}
