type AuthEnv = Partial<Record<'BETTER_AUTH_URL' | 'VERCEL_ENV' | 'VERCEL_PROJECT_PRODUCTION_URL' | 'VERCEL_URL' | 'VERCEL_BRANCH_URL', string>>

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

/**
 * Origins trusted besides the base URL. A preview is opened at its branch URL, which stays the same across redeploys,
 * while its base URL is the per-deployment hostname: without this, signing in there fails the origin check (403). Only
 * that one branch URL is added, never a wildcard. An explicit BETTER_AUTH_URL is the only origin.
 */
export function authTrustedOrigins(env: AuthEnv): string[] {
  if (env.BETTER_AUTH_URL || env.VERCEL_ENV !== 'preview' || !env.VERCEL_BRANCH_URL) return []
  return [`https://${env.VERCEL_BRANCH_URL}`]
}
