import type { ReactNode } from 'react'
import { useLocale } from '../hooks/useLocale'
import { LanguageSwitch } from './LanguageSwitch'
import { Stepper, type Step } from './Stepper'

/** Grid areas live in components.css: brand + account on top and stepper + language below on phones, one row on desktop. */
export function HeaderBar({ step, account }: { step: Step; account?: ReactNode }) {
  const { t } = useLocale()
  return (
    <header className="header">
      <div className="brand">{t.ui.brand}</div>
      <Stepper step={step} />
      <div className="header__lang"><LanguageSwitch /></div>
      {account && <div className="header__account">{account}</div>}
    </header>
  )
}
