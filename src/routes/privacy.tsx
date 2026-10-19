import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/LegalPage'
import { useLocale } from '../hooks/useLocale'

const UPDATED = new Date(2026, 9, 19)

export const Route = createFileRoute('/privacy')({ component: PrivacyPage })

function PrivacyPage() {
  const { t } = useLocale()
  return <LegalPage text={t.privacy} updated={UPDATED} />
}
