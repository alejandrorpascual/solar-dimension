import type { ReactNode } from 'react'
import { useLocale } from '../hooks/useLocale'
import { LanguageSwitch } from './LanguageSwitch'
import { Stepper, type Step } from './Stepper'

export function HeaderBar({ step, account }: { step: Step; account?: ReactNode }) {
  const { t } = useLocale()
  return (
    <header className="header">
      <div className="brand">{t.ui.brand}</div>
      <Stepper step={step} />
      <div className="header__tools">
        <LanguageSwitch />
        {account}
      </div>
    </header>
  )
}
