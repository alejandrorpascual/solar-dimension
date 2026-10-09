import { useLocale } from '../hooks/useLocale'

export type Step = 1 | 2 | 3 | 4

export function Stepper({ step }: { step: Step }) {
  const { t } = useLocale()
  const steps: Step[] = [1, 2, 3, 4]
  const labels: Record<Step, string> = { 1: t.ui.step1, 2: t.ui.step2, 3: t.ui.step3, 4: t.ui.step4 }
  return (
    <nav aria-label="Steps" className="stepper">
      {steps.map((s, i) => (
        <div key={s} className="stepper__item">
          {i > 0 && <div className="stepper__line" aria-hidden="true" />}
          <div className={`dot${s === step ? ' dot--cur' : s < step ? ' dot--done' : ''}`} aria-current={s === step ? 'step' : undefined}>{s}</div>
          <div className={`step-label${s <= step ? ' step-label--on' : ''}`}>{labels[s]}</div>
        </div>
      ))}
    </nav>
  )
}
