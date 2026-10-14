import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { account as accountTable, user as userTable } from '../db/auth-schema'
import { db } from '../db/client'
import { auth } from '../lib/auth'
import { googleProvider } from '../lib/auth-google'
import { canUseQuotes } from '../lib/quote-access'
import type { Rejection } from '../lib/quote-limits'
import { isForAccount } from '../lib/sync'

/** `canUseQuotes` is decided on the server, so the trusted-email list never reaches the browser. */
export interface SessionUser { id: string; email: string; name: string; googleLinked: boolean; canUseQuotes: boolean }

/**
 * Whether the user may start quote reads. Read from the user row and its accounts, not the session: the session cookie
 * caches the user for 5 minutes, so a stale copy could still say "unverified" (or, worse, "verified") after the row
 * changed, and it knows nothing of linked accounts.
 */
async function quotesAllowed(userId: string): Promise<boolean> {
  const [[row], google] = await Promise.all([
    db.select({ email: userTable.email, emailVerified: userTable.emailVerified }).from(userTable).where(eq(userTable.id, userId)).limit(1),
    db.select({ idToken: accountTable.idToken }).from(accountTable)
      .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, 'google'))),
  ])
  return canUseQuotes(row && { ...row, googleIdTokens: google.map((g) => g.idToken) }, process.env)
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

/**
 * The account the page that sends a request was loaded for, its `account` field. A page built before requests carried
 * it does not send it.
 */
export const AccountClaim = z.string().min(1).optional()

/**
 * The signed-in account, refused when it is not the one the page was loaded for. A tab left open across a sign-out
 * and another account's sign-in still shows the first account's projects and quotes, and sends its requests with the
 * second account's cookie: without this its edits and uploads would land in the second account, on any project whose
 * id both hold (every account made before projects took ids of their own has a "p1"). Reading is refused as well: that
 * tab would show the second account's data as the first account's.
 */
export const requireAccount = createServerOnlyFn(async (claimed: string | undefined): Promise<string> => {
  const userId = await requireUserId()
  if (!isForAccount(claimed, userId)) throw new Error('This page was loaded for another account')
  return userId
})

export type QuoteUser = { ok: true; userId: string } | { ok: false; rejection: Rejection }

/**
 * The signed-in account, for the calls that start model reads (upload, retry). Throws when signed out or when the page
 * was loaded for another account, like requireAccount; an account that may not start reads gets a refusal the client
 * shows, as other upload limits are.
 */
export const requireQuoteUser = createServerOnlyFn(async (claimed: string | undefined): Promise<QuoteUser> => {
  const userId = await requireAccount(claimed)
  return (await quotesAllowed(userId)) ? { ok: true, userId } : { ok: false, rejection: { code: 'unverified' } }
})
