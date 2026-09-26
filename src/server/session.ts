import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '../lib/auth'
import { googleProvider } from '../lib/auth-google'

export interface SessionUser { id: string; email: string; name: string; googleLinked: boolean }

export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<{ user: SessionUser } | null> => {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  // Only read on page load and after router.invalidate(), so the account menu knows whether to offer "Connect Google".
  const accounts = await auth.api.listUserAccounts({ headers })
  const googleLinked = accounts.some((a) => a.providerId === 'google')
  return { user: { id: session.user.id, email: session.user.email, name: session.user.name, googleLinked } }
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
