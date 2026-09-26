import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/LegalPage'
import { useLocale } from '../hooks/useLocale'

const UPDATED = new Date(2026, 8, 26)

export const Route = createFileRoute('/terms')({ component: TermsPage })

function TermsPage() {
  const { t } = useLocale()
  return <LegalPage text={t.terms} updated={UPDATED} />
}
