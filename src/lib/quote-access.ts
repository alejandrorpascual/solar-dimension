import { parseEmailList } from './email-list'

/** What the decision needs to know about a user, all read on the server. */
export interface QuoteAccessUser { email: string; emailVerified: boolean; hasGoogle: boolean }

/**
 * Whether a user may start a quote read, which spends the owner's model budget. Sign-up does not confirm emails, so
 * an account counts only when:
 * - its email is verified (a Google sign-in);
 * - it has Google linked. Better Auth links Google only when Google reports the same email as verified (no trusted
 *   providers, no allowDifferentEmails), and the link does not set `emailVerified`;
 * - or it is listed in QUOTES_TRUSTED_EMAILS, which is for previews and tests and is ignored in production.
 */
export function canUseQuotes(
  user: QuoteAccessUser | null | undefined,
  env: { QUOTES_TRUSTED_EMAILS?: string; VERCEL_ENV?: string },
): boolean {
  if (!user) return false
  if (user.emailVerified || user.hasGoogle) return true
  if (env.VERCEL_ENV === 'production') return false
  return parseEmailList(env.QUOTES_TRUSTED_EMAILS).has(user.email.trim().toLowerCase())
}
