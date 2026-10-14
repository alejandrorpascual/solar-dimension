import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { signOut as endSession } from '../lib/auth-client'
import { releaseAccountCopy } from '../lib/persistence'
import { signOutOfBrowser } from '../lib/sign-out'
import type { SessionUser } from '../server/session'

export interface SignOut {
  signOut: () => Promise<void>
  /** True after the last attempt failed, until the next attempt, while the account is still signed in. */
  hasFailed: boolean
}

/**
 * Signing out from the account menu, for the page that holds it. The page says when it failed, under the header: the
 * header has no room for a sentence on a phone. On a shared computer the person must not walk away believing they
 * signed out while their projects are still on screen.
 */
export function useSignOut(user: SessionUser | null): SignOut {
  const router = useRouter()
  const [hasFailed, setFailed] = useState(false)
  const signOut = async () => {
    setFailed(false)
    const hasEnded = await signOutOfBrowser({ signOut: () => endSession(), release: releaseAccountCopy, reload: () => router.invalidate({ sync: true }) })
    setFailed(!hasEnded)
  }
  // An earlier attempt that fails after a later one signed out must not say the account is still signed in.
  return { signOut, hasFailed: hasFailed && user !== null }
}
