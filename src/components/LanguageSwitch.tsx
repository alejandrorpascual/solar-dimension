import { useRouter } from '@tanstack/react-router'
import { useLocale } from '../hooks/useLocale'
import { LOCALES, type Locale } from '../i18n'
import { setLocale } from '../server/locale'

const LABELS: Record<Locale, string> = { en: 'English', es: 'Español' }

export function LanguageSwitch() {
  const { locale, t } = useLocale()
  const router = useRouter()
  async function pick(next: Locale) {
    if (next === locale) return
    await setLocale({ data: { locale: next } })
    await router.invalidate()
  }
  return (
    <div className="lang" role="group" aria-label={t.ui.language}>
      {LOCALES.map((l) => (
        <button key={l} type="button" className={`seg${l === locale ? ' seg--on' : ''}`} aria-pressed={l === locale} onClick={() => pick(l)}>
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
