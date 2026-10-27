import { describe, expect, test } from 'vitest'
import type { SessionUser } from '../server/session'
import { SIGNED_OUT, UNREACHABLE, sessionOf, signedInUser, type AccountSession } from './account-session'

const ANA: SessionUser = { id: 'user-ana', email: 'ana@example.com', name: 'Ana', googleLinked: false, canUseQuotes: true }

describe('account session', () => {
  test('a read user is a signed-in session that gives the user back', () => {
    const session = sessionOf(ANA)
    expect(session).toEqual({ status: 'signed-in', user: ANA })
    expect(signedInUser(session)).toBe(ANA)
  })

  test('no user read is a signed-out session with no user', () => {
    expect(sessionOf(null)).toBe(SIGNED_OUT)
    expect(signedInUser(SIGNED_OUT)).toBeNull()
  })

  test('an unreachable account gives no user', () => {
    expect(signedInUser(UNREACHABLE)).toBeNull()
  })

  test('the type cannot hold a user and the unreachable state at once', () => {
    // @ts-expect-error an unreachable session has no user
    const both: AccountSession = { status: 'unreachable', user: ANA }
    expect(both.status).toBe('unreachable')
  })
})
