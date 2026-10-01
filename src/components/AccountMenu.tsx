import { Link, useRouter } from '@tanstack/react-router'
import { ChevronDown, Link2, LogIn, LogOut } from 'lucide-react'
import { Button, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, type Key } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import { useConnectGoogle } from '../hooks/useConnectGoogle'
import { tr } from '../i18n'
import { signOut } from '../lib/auth-client'
import type { SessionUser } from '../server/session'

interface Props {
  user: SessionUser | null
  /** True while projects are still syncing or saving; signing out then would lose the in-flight write. */
  busy?: boolean
}

/** One letter for the avatar: the name's first letter, else the email's. */
function initialOf(user: SessionUser): string {
  return (user.name.trim() || user.email).charAt(0).toUpperCase()
}

export function AccountMenu({ user, busy = false }: Props) {
  const { t } = useLocale()
  const router = useRouter()
  const google = useConnectGoogle(user)
  if (!user) {
    return (
      <Link to="/login" className="chip">
        <LogIn size={16} strokeWidth={2} aria-hidden="true" />
        {t.ui.signIn}
      </Link>
    )
  }
  const signedInAs = tr(t, 'signedInAs', { email: user.email })
  const canLinkGoogle = google.canConnect
  async function act(key: Key) {
    if (key === 'google') return google.connect()
    if (key === 'signout') {
      await signOut()
      await router.invalidate({ sync: true })
    }
  }
  return (
    <MenuTrigger>
      <Button className="chip hmenu__trigger hmenu__trigger--avatar" aria-label={signedInAs}>
        <span className="avatar" aria-hidden="true">{initialOf(user)}</span>
        <ChevronDown size={14} strokeWidth={2} className="hmenu__chev" aria-hidden="true" />
      </Button>
      <Popover className="hmenu__pop" placement="bottom end" offset={6}>
        <Menu className="hmenu__list" aria-label={signedInAs} onAction={act} disabledKeys={busy ? ['google', 'signout'] : []}>
          <MenuSection>
            <Header className="hmenu__who">
              <span className="avatar avatar--lg" aria-hidden="true">{initialOf(user)}</span>
              <span className="hmenu__email" title={user.email}>{signedInAs}</span>
            </Header>
            {canLinkGoogle && (
              <MenuItem id="google" className="hmenu__item" textValue={t.ui.connectGoogle}>
                <Link2 size={16} strokeWidth={2} aria-hidden="true" />
                <span className="hmenu__label">{t.ui.connectGoogle}</span>
              </MenuItem>
            )}
            <MenuItem id="signout" className="hmenu__item" textValue={t.ui.signOut}>
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              <span className="hmenu__label">{t.ui.signOut}</span>
            </MenuItem>
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
