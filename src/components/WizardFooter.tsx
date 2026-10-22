import { Download } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { ChecksAttention } from './ChecksAttention'
import type { Step } from './Stepper'

interface Props {
  step: Step; summary: string
  /** "2 checks need attention" on the kit step, or null when every check passes. */
  attention: string | null
  onBack: () => void; onNext: () => void; onStartOver: () => void
  /** The kit step's main action: opens the Download tab, in the side rail where it shows and in a sheet elsewhere. */
  onDownload: () => void
}

export function WizardFooter({ step, summary, attention, onBack, onNext, onStartOver, onDownload }: Props) {
  const { t } = useLocale()
  return (
    <footer className="footer">
      <div className="footer__line">
        {step === 4 && <ChecksAttention text={attention} />}
        <div className="num muted footer__summary">{summary}</div>
      </div>
      <div className="footer__actions">
        {(step === 2 || step === 3) && <button type="button" className="btn" onClick={onBack}>{t.ui.back}</button>}
        {step < 4 && (
          <button type="button" className="btn btn--primary" onClick={onNext}>
            {step === 1 ? t.ui.next : step === 2 ? t.ui.nextSolar : t.ui.buildKit}
          </button>
        )}
        {step === 4 && <button type="button" className="btn" onClick={onStartOver}>{t.ui.startOver}</button>}
        {step === 4 && (
          <button type="button" className="btn btn--primary footer__download" onClick={onDownload}>
            <Download size={18} aria-hidden="true" />{t.ui.download}
          </button>
        )}
      </div>
    </footer>
  )
}
