import { useLocation } from '@tanstack/react-router'
import { linkSocial } from '../lib/auth-client'
import type { SessionUser } from '../server/session'
import { useRootData } from './useRootData'

/**
 * Attaching Google to the signed-in account. Linking needs the current session, so only the account's owner can do
 * it; Google returns to the page it started from. Offered when this deployment has Google and the account lacks it.
 */
export function useConnectGoogle(user: SessionUser | null): { canConnect: boolean; connect: () => Promise<void> } {
  const { googleEnabled } = useRootData()
  const here = useLocation({ select: (l) => l.href })
  const connect = async () => {
    const res = await linkSocial({ provider: 'google', callbackURL: here })
    if (res?.error) console.error('[auth] connecting Google failed', { error: res.error })
  }
  return { canConnect: googleEnabled && user !== null && !user.googleLinked, connect }
}
