import { Download } from 'lucide-react'
import { useRef } from 'react'
import { useHeightProperty } from '../hooks/useHeightProperty'
import { useLocale } from '../hooks/useLocale'
import { ChecksAttention } from './ChecksAttention'
import type { Step } from './Stepper'

interface Props {
  step: Step; summary: string
  /** The same line cut to what fits one row under 1024px, where the project's name and the rest show elsewhere. */
  summarySlim?: string
  /** "2 checks need attention" on the kit step, or null when every check passes. */
  attention: string | null
  /** Why Next is off, as a tooltip: later steps need an appliance, as in the stepper. Null while Next is on. */
  nextLocked: string | null
  onBack: () => void; onNext: () => void
  /** The kit step's main action: opens the Download tab, in the side rail where it shows and in a sheet elsewhere. */
  onDownload: () => void
  /** Step 1 was opened from the kit: the main action goes back there. */
  onBackToKit?: () => void
  /** The kit step has no appliances, so nothing to download yet: the main action goes to add some. */
  onAddAppliances?: () => void
  /** The rail's Download tab is open, and from 1280px its button shows beside this one. */
  isDownloadOpen?: boolean
}

/**
 * Read by base.css and quotes.css, which leave that much room under the page and above the footer for it. It is not a
 * constant on a phone: the summary wraps, so a long project name or the attention pill beside it makes the footer taller.
 */
const FOOTER_HEIGHT_PROPERTY = '--footer-h'

export function WizardFooter({ step, summary, summarySlim, attention, nextLocked, onBack, onNext, onDownload, onBackToKit, onAddAppliances, isDownloadOpen }: Props) {
  const { t } = useLocale()
  const element = useRef<HTMLElement>(null)
  useHeightProperty(element, FOOTER_HEIGHT_PROPERTY)
  return (
    <footer className="footer" ref={element}>
      <div className="footer__line">
        {step === 4 && <ChecksAttention text={attention} />}
        {summarySlim === undefined
          ? <div className="num muted footer__summary">{summary}</div>
          : (
            <div className="num muted footer__summary">
              <span className="footer__wide">{summary}</span>
              <span className="footer__slim">{summarySlim}</span>
            </div>
          )}
      </div>
      <div className="footer__actions">
        {step > 1 && <button type="button" className="btn" onClick={onBack}>{t.ui.back}</button>}
        {step < 4 && (
          <button type="button" className="btn btn--primary" disabled={nextLocked !== null} title={nextLocked ?? undefined} onClick={onBackToKit ?? onNext}>
            {onBackToKit ? t.ui.backToKit : step === 1 ? t.ui.next : step === 2 ? t.ui.nextSolar : t.ui.buildKit}
          </button>
        )}
        {step === 4 && onAddAppliances && <button type="button" className="btn btn--primary" onClick={onAddAppliances}>{t.ui.addAppliances}</button>}
        {step === 4 && !onAddAppliances && (
          <button type="button" className={`btn btn--primary footer__download${isDownloadOpen ? ' footer__download--open' : ''}`} onClick={onDownload}>
            <Download size={18} aria-hidden="true" />{t.ui.download}
          </button>
        )}
      </div>
    </footer>
  )
}
