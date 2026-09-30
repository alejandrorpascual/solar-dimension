import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { user as userTable } from '../db/auth-schema'
import { db } from '../db/client'
import { auth } from '../lib/auth'
import { googleProvider } from '../lib/auth-google'
import { canUseQuotes } from '../lib/quote-access'
import type { Rejection } from '../lib/quote-limits'

/** `canUseQuotes` is decided on the server, so the trusted-email list never reaches the browser. */
export interface SessionUser { id: string; email: string; name: string; googleLinked: boolean; canUseQuotes: boolean }

/**
 * Whether the user may start quote reads. Read from the user row, not the session: the session cookie caches the user
 * for 5 minutes, so a stale copy could still say "unverified" (or, worse, "verified") after the row changed.
 */
async function quotesAllowed(userId: string): Promise<boolean> {
  const [row] = await db.select({ email: userTable.email, emailVerified: userTable.emailVerified }).from(userTable)
    .where(eq(userTable.id, userId)).limit(1)
  return canUseQuotes(row, process.env.QUOTES_TRUSTED_EMAILS)
}

export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<{ user: SessionUser } | null> => {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  // Only read on page load and after router.invalidate(), so the account menu knows whether to offer "Connect Google".
  const [accounts, mayUseQuotes] = await Promise.all([auth.api.listUserAccounts({ headers }), quotesAllowed(session.user.id)])
  const googleLinked = accounts.some((a) => a.providerId === 'google')
  return { user: { id: session.user.id, email: session.user.email, name: session.user.name, googleLinked, canUseQuotes: mayUseQuotes } }
})

/** Which sign-in methods this deployment offers. Previews have no Google credentials, so they hide the button. */
export const getAuthFeatures = createServerFn({ method: 'GET' }).handler(async (): Promise<{ googleEnabled: boolean }> => ({
  googleEnabled: googleProvider(process.env) !== null,
}))

export const requireUserId = createServerOnlyFn(async (): Promise<string> => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  return session.user.id
})

export type QuoteUser = { ok: true; userId: string } | { ok: false; rejection: Rejection }

/**
 * The signed-in user, for the calls that start model reads (upload, retry). Throws when signed out, like
 * requireUserId; an account that may not start reads gets a refusal the client shows, as other upload limits are.
 */
export const requireQuoteUser = createServerOnlyFn(async (): Promise<QuoteUser> => {
  const userId = await requireUserId()
  return (await quotesAllowed(userId)) ? { ok: true, userId } : { ok: false, rejection: { code: 'unverified' } }
})
