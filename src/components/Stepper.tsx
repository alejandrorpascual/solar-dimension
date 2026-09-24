export type Step = 1 | 2 | 3

const LABELS: Record<Step, string> = { 1: 'Appliances', 2: 'Backup window', 3: 'Your kit' }

export function Stepper({ step }: { step: Step }) {
  const steps: Step[] = [1, 2, 3]
  return (
    <nav aria-label="Steps" className="stepper">
      {steps.map((s, i) => (
        <div key={s} className="stepper__item">
          {i > 0 && <div className="stepper__line" aria-hidden="true" />}
          <div className={`dot${s === step ? ' dot--cur' : s < step ? ' dot--done' : ''}`} aria-current={s === step ? 'step' : undefined}>{s}</div>
          <div className={`step-label${s <= step ? ' step-label--on' : ''}`}>{LABELS[s]}</div>
        </div>
      ))}
    </nav>
  )
}
