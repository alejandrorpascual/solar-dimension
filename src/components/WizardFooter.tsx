import { useLocale } from '../hooks/useLocale'
import type { Step } from './Stepper'

interface Props { step: Step; summary: string; onBack: () => void; onNext: () => void; onStartOver: () => void }

export function WizardFooter({ step, summary, onBack, onNext, onStartOver }: Props) {
  const { t } = useLocale()
  return (
    <footer className="footer">
      <div className="num muted footer__summary">{summary}</div>
      <div className="footer__actions">
        {step === 2 && <button type="button" className="btn" onClick={onBack}>{t.ui.back}</button>}
        {step < 3 && (
          <button type="button" className="btn btn--primary" onClick={onNext}>
            {step === 1 ? t.ui.next : t.ui.buildKit}
          </button>
        )}
        {step === 3 && <button type="button" className="btn btn--primary" onClick={onStartOver}>{t.ui.startOver}</button>}
      </div>
    </footer>
  )
}
