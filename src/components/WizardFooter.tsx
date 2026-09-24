import type { Step } from './Stepper'

interface Props { step: Step; summary: string; onBack: () => void; onNext: () => void; onStartOver: () => void }

export function WizardFooter({ step, summary, onBack, onNext, onStartOver }: Props) {
  return (
    <footer className="footer">
      <div className="num muted footer__summary">{summary}</div>
      <div className="footer__actions">
        {step === 2 && <button type="button" className="btn" onClick={onBack}>Back</button>}
        {step < 3 && (
          <button type="button" className="btn btn--primary" onClick={onNext}>
            {step === 1 ? 'Next: backup window' : 'Build my kit'}
          </button>
        )}
        {step === 3 && <button type="button" className="btn btn--primary" onClick={onStartOver}>Start over</button>}
      </div>
    </footer>
  )
}
