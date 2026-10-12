import { Link } from '@tanstack/react-router'
import { useLocale } from '../hooks/useLocale'

/** Privacy and Terms of use: on the sign-in page and under every step of the app, so neither needs an account or a kit to reach. */
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
