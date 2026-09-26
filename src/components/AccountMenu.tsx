import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { useRootData } from '../hooks/useRootData'
import { tr } from '../i18n'
import { linkSocial, signOut } from '../lib/auth-client'
import type { SessionUser } from '../server/session'

interface Props {
  user: SessionUser | null
  /** True while projects are still syncing or saving; signing out then would lose the in-flight write. */
  busy?: boolean
}

export function AccountMenu({ user, busy = false }: Props) {
  const { t } = useLocale()
  const router = useRouter()
  const { googleEnabled } = useRootData()
  const here = useLocation({ select: (l) => l.href })
  if (!user) {
    return (
      <Link to="/login" className="chip">
        <LogIn size={16} strokeWidth={2} aria-hidden="true" />
        {t.ui.signIn}
      </Link>
    )
  }
  const signedInAs = tr(t, 'signedInAs', { email: user.email })
  return (
    <div className="account">
      <span className="account__email muted" title={signedInAs}>{signedInAs}</span>
      {googleEnabled && !user.googleLinked && (
        // Linking needs the current session, so only the account's owner can attach Google. Google returns here.
        <button type="button" className="chip" disabled={busy} aria-busy={busy} onClick={() => linkSocial({ provider: 'google', callbackURL: here })}>{t.ui.connectGoogle}</button>
      )}
      <button type="button" className="chip" disabled={busy} aria-busy={busy} onClick={async () => { await signOut(); await router.invalidate({ sync: true }) }}>{t.ui.signOut}</button>
    </div>
  )
}
