import { useLocation } from '@tanstack/react-router'
import { useState } from 'react'
import { linkSocial } from '../lib/auth-client'
import type { SessionUser } from '../server/session'
import { useRootData } from './useRootData'

export interface ConnectGoogle {
  canConnect: boolean
  connect: () => Promise<void>
  /** True after the last attempt failed before leaving for Google, until the next attempt. */
  hasFailed: boolean
}

/**
 * Attaching Google to the signed-in account. Linking needs the current session, so only the account's owner can do
 * it; Google returns to the page it started from. Offered when this deployment has Google and the account lacks it.
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
  return { canConnect: googleEnabled && user !== null && !user.googleLinked, connect, hasFailed }
}
