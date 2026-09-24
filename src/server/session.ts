import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '../lib/auth'

export interface SessionUser { id: string; email: string; name: string }

export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<{ user: SessionUser } | null> => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return session ? { user: { id: session.user.id, email: session.user.email, name: session.user.name } } : null
})

export const requireUserId = createServerOnlyFn(async (): Promise<string> => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session) throw new Error('Unauthorized')
  return session.user.id
})
