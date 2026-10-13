import { Link } from '@tanstack/react-router'
import { useLocale } from '../hooks/useLocale'

/**
 * Privacy and Terms of use. Under every step of the builder as well as on the sign-in page, because the builder gives
 * its estimate without an account and a signed-in visitor is redirected away from the sign-in page.
 */
export function LegalLinks() {
  const { t } = useLocale()
  return (
    <nav className="fine muted legal" aria-label={t.ui.legal}>
      <Link to="/privacy">{t.privacy.title}</Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms">{t.terms.title}</Link>
    </nav>
  )
}
