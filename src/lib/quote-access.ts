import { parseEmailList } from './email-list'

/** What the decision needs to know about a user, all read on the server. */
export interface QuoteAccessUser {
  email: string
  emailVerified: boolean
  /** The stored id_token of each Google account row the user has (null when a row has none). */
  googleIdTokens: readonly (string | null)[]
}

const JWT_PARTS = 3

/** The payload of a JWT, unverified, or null when it isn't one. */
function jwtPayload(token: string): unknown {
  const parts = token.split('.')
  if (parts.length !== JWT_PARTS || !parts[1]) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
  } catch {
    // Not base64 or not JSON: not a token Google issued, so it proves nothing. Callers treat it as unverified.
    return null
  }
}

/**
 * Whether a Google account row's stored id_token says Google verified the user's own email. Only the payload is read:
 * Better Auth stored the token as it came from Google's token endpoint, over TLS, so its signature needs no re-check.
 * A Google row alone is not enough: a Google sign-up creates one whatever Google says about the email.
 */
export function googleIdTokenVerifies(idToken: string | null | undefined, email: string): boolean {
  if (!idToken) return false
  const claims = jwtPayload(idToken)
  if (typeof claims !== 'object' || claims === null) return false
  const { email: claimed, email_verified: isVerified } = claims as { email?: unknown; email_verified?: unknown }
  return isVerified === true && typeof claimed === 'string' && claimed.trim().toLowerCase() === email.trim().toLowerCase()
}

/**
 * Whether a user may start a quote read, which spends the owner's model budget. Sign-up does not confirm emails, so
 * an account counts only when:
 * - its email is verified (a Google sign-in with a verified email);
 * - it has a Google account whose id_token says Google verified this same email (connecting Google does not set
 *   `emailVerified`);
 * - or it is listed in QUOTES_TRUSTED_EMAILS, which is for previews and tests and is ignored in production.
 */
export function canUseQuotes(
  user: QuoteAccessUser | null | undefined,
  env: { QUOTES_TRUSTED_EMAILS?: string; VERCEL_ENV?: string },
): boolean {
  if (!user) return false
  if (user.emailVerified || user.googleIdTokens.some((t) => googleIdTokenVerifies(t, user.email))) return true
  if (env.VERCEL_ENV === 'production') return false
  return parseEmailList(env.QUOTES_TRUSTED_EMAILS).has(user.email.trim().toLowerCase())
}
