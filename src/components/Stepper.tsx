import { Check } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { isStepReachable, STEPS, type Step } from '../lib/steps'

export type { Step } from '../lib/steps'

interface Props {
  step: Step
  /** Moves to a step; without it the stepper only shows where you are. */
  onGo?: (step: Step) => void
  /** Steps after the appliances need at least one; they stay disabled until then. */
  hasAppliances?: boolean
}

export function Stepper({ step, onGo, hasAppliances = true }: Props) {
  const { t } = useLocale()
  const labels: Record<Step, string> = { 1: t.ui.step1, 2: t.ui.step2, 3: t.ui.step3, 4: t.ui.step4 }
  return (
    <nav aria-label="Steps" className="stepper">
      {STEPS.map((s, i) => {
        const isCurrent = s === step
        const isDone = s < step
        const isLocked = !isStepReachable(s, hasAppliances)
        return (
          <div key={s} className="stepper__item">
            {i > 0 && <div className={`stepper__line${s <= step ? ' stepper__line--on' : ''}`} aria-hidden="true" />}
            <button
              type="button"
              className="stepper__btn"
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={tr(t, 'stepGo', { n: s, label: labels[s] })}
              title={isLocked ? t.ui.stepLocked : undefined}
              disabled={isLocked || !onGo}
              onClick={() => { if (!isCurrent) onGo?.(s) }}
            >
              <span className={`dot${isCurrent ? ' dot--cur' : isDone ? ' dot--done' : ''}${isLocked ? ' dot--locked' : ''}`} aria-hidden="true">
                {isDone ? <Check size={16} strokeWidth={3} /> : s}
              </span>
              <span className={`step-label${s <= step ? ' step-label--on' : ''}`} aria-hidden="true">{labels[s]}</span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}
