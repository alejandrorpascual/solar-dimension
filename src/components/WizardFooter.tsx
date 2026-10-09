import { Download } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import type { Step } from './Stepper'

interface Props {
  step: Step; summary: string
  onBack: () => void; onNext: () => void; onStartOver: () => void
  /** Opens the download sheet; the button only shows where the side rail is hidden. */
  onDownload: () => void
}

export function WizardFooter({ step, summary, onBack, onNext, onStartOver, onDownload }: Props) {
  const { t } = useLocale()
  return (
    <footer className="footer">
      <div className="num muted footer__summary">{summary}</div>
      <div className="footer__actions">
        {(step === 2 || step === 3) && <button type="button" className="btn" onClick={onBack}>{t.ui.back}</button>}
        {step < 4 && (
          <button type="button" className="btn btn--primary" onClick={onNext}>
            {step === 1 ? t.ui.next : step === 2 ? t.ui.nextSolar : t.ui.buildKit}
          </button>
        )}
        {step === 4 && (
          <button type="button" className="btn footer__download" aria-haspopup="dialog" onClick={onDownload}>
            <Download size={18} aria-hidden="true" />{t.ui.download}
          </button>
        )}
        {step === 4 && <button type="button" className="btn btn--primary" onClick={onStartOver}>{t.ui.startOver}</button>}
      </div>
    </footer>
  )
}
