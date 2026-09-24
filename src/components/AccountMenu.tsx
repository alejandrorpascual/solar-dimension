import { Link, useRouter } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { signOut } from '../lib/auth-client'
import type { SessionUser } from '../server/session'

interface Props {
  user: SessionUser | null
  /** True while projects are still syncing or saving; signing out then would lose the in-flight write. */
  busy?: boolean
}

export function AccountMenu({ user, busy = false }: Props) {
  const { t } = useLocale()
  const router = useRouter()
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
      <button type="button" className="chip" disabled={busy} aria-busy={busy} onClick={async () => { await signOut(); await router.invalidate() }}>{t.ui.signOut}</button>
    </div>
  )
}
