import { useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { linkSocial } from '../lib/auth-client'
import type { SessionUser } from '../server/session'
import { useRootData } from './useRootData'

export interface ConnectGoogle {
  canConnect: boolean
  connect: () => Promise<void>
  /** True after the last attempt failed before leaving for Google, until the next attempt, while it is still offered. */
  hasFailed: boolean
}

/**
 * Attaching Google to the signed-in account. Linking needs the current session, so only the account's owner can do
 * it; Google returns to the page it started from. Offered when this deployment has Google and the account lacks it.
 * Each caller has its own attempt: the account menu's failure shows under the page's header, the quotes button's
 * beside the button, so one failure is said once.
 */
export function useConnectGoogle(user: SessionUser | null): ConnectGoogle {
  const { googleEnabled } = useRootData()
  const here = useLocation({ select: (l) => l.href })
  const [hasFailed, setFailed] = useState(false)
  const connect = async () => {
    setFailed(false)
    try {
      const res = await linkSocial({ provider: 'google', callbackURL: here })
      if (!res?.error) return
      console.error('[auth] connecting Google failed', { error: res.error })
    } catch (error) {
      console.error('[auth] connecting Google failed', { error })
    }
    setFailed(true)
  }
  const canConnect = googleEnabled && user !== null && !user.googleLinked
  // The page that holds the menu outlives a sign-out: a failure from before it must not show to nobody.
  return { canConnect, connect, hasFailed: hasFailed && canConnect }
}
