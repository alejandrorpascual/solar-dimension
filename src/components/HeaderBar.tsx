import type { ReactNode } from 'react'
import { APP_NAME } from '../lib/brand'
import { LanguageSwitch } from './LanguageSwitch'
import { Stepper, type Step } from './Stepper'

/**
 * Grid areas live in components.css: brand, language and account on top and the stepper below on phones, one row on
 * desktop. Without a `step` (pages outside the step flow, like /privacy) the stepper is left out.
 */
interface Props {
  step?: Step
  account?: ReactNode
  onGo?: (step: Step) => void
  hasAppliances?: boolean
}

export function HeaderBar({ step, account, onGo, hasAppliances }: Props) {
  return (
    <header className="header">
      <div className="brand">{APP_NAME}</div>
      {step && <Stepper step={step} onGo={onGo} hasAppliances={hasAppliances} />}
      <div className="header__lang"><LanguageSwitch /></div>
      {account && <div className="header__account">{account}</div>}
    </header>
  )
}
