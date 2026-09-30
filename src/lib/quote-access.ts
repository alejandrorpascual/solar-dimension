import { parseEmailList } from './email-list'

/**
 * Whether a user may start a quote read, which spends the owner's model budget. Sign-up does not confirm emails, so
 * an account counts only when its email is verified (a Google sign-in), or when it is listed in QUOTES_TRUSTED_EMAILS,
 * which is meant for previews and tests only.
 */
export function canUseQuotes(user: { email: string; emailVerified: boolean } | null | undefined, trustedRaw: string | undefined): boolean {
  if (!user) return false
  if (user.emailVerified) return true
  return parseEmailList(trustedRaw).has(user.email.trim().toLowerCase())
}
