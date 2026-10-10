import type { ReactNode } from 'react'
import { APP_NAME } from '../lib/brand'
import { LanguageSwitch } from './LanguageSwitch'
import { Stepper, type StepperProps } from './Stepper'

interface Props {
  /** Left out on pages outside the step flow, like /privacy: the header then has no stepper. */
  stepper?: StepperProps
  account?: ReactNode
}

/**
 * Brand, stepper, language and account. The layout lives in components.css: the stepper has a row of its own under
 * the other three, and joins their row only where the header itself is wide enough to hold all four side by side.
 * The inner bar is there because that rule asks the header for its width, and an element cannot ask itself.
 */
export function HeaderBar({ stepper, account }: Props) {
  return (
    <header className="header">
      <div className="header__bar">
        <div className="brand">{APP_NAME}</div>
        {stepper && <Stepper {...stepper} />}
        <div className="header__lang"><LanguageSwitch /></div>
        {account && <div className="header__account">{account}</div>}
      </div>
    </header>
  )
}
