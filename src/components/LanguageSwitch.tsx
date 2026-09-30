import { useRouter } from '@tanstack/react-router'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { Button, Menu, MenuItem, MenuTrigger, Popover, type Key } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import { LOCALES, type Locale } from '../i18n'
import { setLocale } from '../server/locale'

/** Each language is named in itself, so a reader who can't read the current one still finds theirs. */
const LABELS: Record<Locale, string> = { en: 'English', es: 'Español' }

export function LanguageSwitch() {
  const { locale, t } = useLocale()
  const router = useRouter()
  async function pick(key: Key) {
    const next = key as Locale
    if (next === locale) return
    await setLocale({ data: { locale: next } })
    await router.invalidate({ sync: true })
  }
  return (
    <MenuTrigger>
      <Button className="chip hmenu__trigger" aria-label={`${t.ui.language}: ${LABELS[locale]}`}>
        <Globe size={16} strokeWidth={2} aria-hidden="true" />
        <span className="hmenu__code">{locale.toUpperCase()}</span>
        <ChevronDown size={14} strokeWidth={2} className="hmenu__chev" aria-hidden="true" />
      </Button>
      <Popover className="hmenu__pop" placement="bottom end" offset={6}>
        <Menu className="hmenu__list" aria-label={t.ui.language} selectionMode="single" selectedKeys={[locale]} onAction={pick}>
          {LOCALES.map((l) => (
            <MenuItem key={l} id={l} className="hmenu__item" textValue={LABELS[l]}>
              {({ isSelected }) => (
                <>
                  <span className="hmenu__label">{LABELS[l]}</span>
                  {isSelected && <Check size={16} strokeWidth={2.25} className="hmenu__check" aria-hidden="true" />}
                </>
              )}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
