import type { ReactNode } from 'react'
import { APP_NAME } from '../lib/brand'
import { LanguageSwitch } from './LanguageSwitch'
import { Stepper, type StepperProps } from './Stepper'

/**
 * Grid areas live in components.css: brand, language and account on top and the stepper below on phones, one row on
 * desktop.
 */
interface Props {
  /** Left out on pages outside the step flow, like /privacy: the header then has no stepper. */
  stepper?: StepperProps
  account?: ReactNode
}

export function HeaderBar({ stepper, account }: Props) {
  return (
    <header className="header">
      <div className="brand">{APP_NAME}</div>
      {stepper && <Stepper {...stepper} />}
      <div className="header__lang"><LanguageSwitch /></div>
      {account && <div className="header__account">{account}</div>}
    </header>
  )
}
