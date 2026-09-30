import type { ReactNode } from 'react'
import { APP_NAME } from '../lib/brand'
import { LanguageSwitch } from './LanguageSwitch'
import { Stepper, type Step } from './Stepper'

/**
 * Grid areas live in components.css: brand, language and account on top and the stepper below on phones, one row on
 * desktop. Without a `step` (pages outside the three-step flow, like /privacy) the stepper is left out.
 */
export function HeaderBar({ step, account }: { step?: Step; account?: ReactNode }) {
  return (
    <header className="header">
      <div className="brand">{APP_NAME}</div>
      {step && <Stepper step={step} />}
      <div className="header__lang"><LanguageSwitch /></div>
      {account && <div className="header__account">{account}</div>}
    </header>
  )
}
