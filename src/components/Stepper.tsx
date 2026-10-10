import { Check } from 'lucide-react'
import { Fragment } from 'react'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { stepStates, type Step, type StepState } from '../lib/steps'

export type { Step } from '../lib/steps'

/** Shows where you are and nothing else: no step can be clicked (the sign-in page). */
interface DisplayOnlyProps {
  step: Step
  onGo?: undefined
  hasAppliances?: undefined
}

/** Moves between steps. */
interface NavigableProps {
  step: Step
  onGo: (step: Step) => void
  /** Steps after the appliances need at least one. Required with `onGo`, so forgetting it is a type error and not four open steps. */
  hasAppliances: boolean
}

export type StepperProps = DisplayOnlyProps | NavigableProps

const dotClass = ({ isCurrent, isDone, isLocked }: StepState): string =>
  `dot${isCurrent ? ' dot--cur' : isDone ? ' dot--done' : ''}${isLocked ? ' dot--locked' : ''}`

export function Stepper(props: StepperProps) {
  const { t } = useLocale()
  const labels: Record<Step, string> = { 1: t.ui.step1, 2: t.ui.step2, 3: t.ui.step3, 4: t.ui.step4 }
  const { onGo } = props
  // Display only: no step can be clicked, so none is drawn as locked.
  const hasAppliances = props.onGo ? props.hasAppliances : true
  const states = stepStates(props.step, hasAppliances)
  return (
    <nav aria-label="Steps" className="stepper">
      {states.map((state, i) => {
        const { step, isCurrent, isDone, isLocked, isReached } = state
        return (
          <Fragment key={step}>
            {i > 0 && <div className={`stepper__line${isReached ? ' stepper__line--on' : ''}`} aria-hidden="true" />}
            <button
              type="button"
              className="stepper__btn"
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={tr(t, 'stepGo', { n: step, label: labels[step] })}
              title={isLocked ? t.ui.stepLocked : undefined}
              disabled={isLocked || !onGo}
              onClick={() => { if (!isCurrent) onGo?.(step) }}
            >
              <span className={dotClass(state)} aria-hidden="true">{isDone ? <Check size={16} strokeWidth={3} /> : step}</span>
              <span className={`step-label${isCurrent || isDone ? ' step-label--on' : ''}`} aria-hidden="true">{labels[step]}</span>
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}
