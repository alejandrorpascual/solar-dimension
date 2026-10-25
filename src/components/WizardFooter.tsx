import { Download } from 'lucide-react'
import { useEffect, useRef, type RefObject } from 'react'
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

/** Read by base.css and quotes.css, which leave that much room under the page and above the footer for it. */
const FOOTER_HEIGHT_PROPERTY = '--footer-h'

/**
 * Keeps the footer's height in FOOTER_HEIGHT_PROPERTY. It is not a constant on a phone: the summary wraps, so a long
 * project name or the attention pill beside it makes the footer taller.
 */
function useFooterHeight(element: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const footer = element.current
    if (!footer) return
    const root = document.documentElement
    const publish = () => root.style.setProperty(FOOTER_HEIGHT_PROPERTY, `${footer.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(footer)
    return () => {
      observer.disconnect()
      root.style.removeProperty(FOOTER_HEIGHT_PROPERTY)
    }
  }, [element])
}

export function WizardFooter({ step, summary, attention, onBack, onNext, onStartOver, onDownload }: Props) {
  const { t } = useLocale()
  const element = useRef<HTMLElement>(null)
  useFooterHeight(element)
  return (
    <footer className="footer" ref={element}>
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
