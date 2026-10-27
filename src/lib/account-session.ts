import type { SessionUser } from '../server/session'

/**
 * Who the page was loaded for. `unreachable`: the session could not be read (the database is down), so someone may be
 * signed in and nobody can tell who. It carries no user, so a screen that reads the user meets that case where it does.
 */
export type AccountSession =
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly user: SessionUser }
  | { readonly status: 'unreachable' }

export const SIGNED_OUT: AccountSession = { status: 'signed-out' }
export const UNREACHABLE: AccountSession = { status: 'unreachable' }

/** The session for the user a read found, or for nobody. */
export function sessionOf(user: SessionUser | null): AccountSession {
  return user ? { status: 'signed-in', user } : SIGNED_OUT
}

/** The signed-in user; null when signed out or when the account cannot be reached. */
export function signedInUser(session: AccountSession): SessionUser | null {
  return session.status === 'signed-in' ? session.user : null
}
