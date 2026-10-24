import { Link, useRouterState } from '@tanstack/react-router'
import { Check, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useElapsedSeconds } from '../../hooks/useElapsedSeconds'
import { useLocale } from '../../hooks/useLocale'
import { useQuoteJobs } from '../../hooks/useQuoteJobs'
import { trq } from '../../i18n'
import { etaSeconds, pickTray } from '../../lib/quote-jobs'
import { elapsedText, etaText, fileStatusText } from '../../lib/quote-text'
import { Spinner } from './Spinner'

const VERDICT_ROUTE_ID = '/projects/$projectId/quotes'
const META_SEPARATOR = ' · '

/** The project whose verdict page is open, if one is: the tray has nothing to add there. */
function useVerdictProjectId(): string | null {
  return useRouterState({
    select: (s) => {
      const match = s.matches.find((m) => m.routeId === VERDICT_ROUTE_ID)
      return match ? ((match.params as { projectId?: string }).projectId ?? null) : null
    },
  })
}

/** Read by quotes.css, which leaves that much room under the end of the page for the tray to float over. */
const TRAY_ROOM_PROPERTY = '--qtray-room'

/**
 * Keeps the tray's height in TRAY_ROOM_PROPERTY while it shows. It is not a constant: the tray is taller once the
 * verdict is ready on a narrow phone, with a long project name, or with its file list open.
 */
function useTrayRoom(element: RefObject<HTMLElement | null>, isShown: boolean): void {
  useEffect(() => {
    const tray = element.current
    if (!isShown || !tray) return
    const root = document.documentElement
    const publish = () => root.style.setProperty(TRAY_ROOM_PROPERTY, `${tray.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(tray)
    return () => {
      observer.disconnect()
      root.style.removeProperty(TRAY_ROOM_PROPERTY)
    }
  }, [element, isShown])
}

/** Follows the user around the app while quotes are read, then says the verdict is ready. */
export function QuoteTray() {
  const { t } = useLocale()
  const { jobs, offline, markSeen } = useQuoteJobs()
  const hidden = useVerdictProjectId()
  const [isOpen, setOpen] = useState(false)
  const element = useRef<HTMLElement>(null)
  const tray = pickTray(jobs, hidden)
  useTrayRoom(element, tray !== null)
  const elapsed = useElapsedSeconds(tray?.mode === 'reading')
  if (!tray) return null
  const p = tray.project

  if (tray.mode === 'ready') {
    return (
      <section ref={element} className="qtray" aria-label={t.quotes.trayLabel} aria-live="polite">
        <div className="qtray__row">
          <span className="qtray__icon" aria-hidden="true"><Check size={20} /></span>
          <p className="qtray__title qtray__text">{trq(t, 'trayReady', { project: p.projectName })}</p>
          <Link className="qtray__link" to="/projects/$projectId/quotes" params={{ projectId: p.projectId }}>{t.quotes.seeVerdict}</Link>
          <button type="button" className="qtray__btn" aria-label={t.quotes.trayDismiss} onClick={() => void markSeen(p.projectId)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    )
  }

  const eta = etaSeconds(p)
  const meta = [
    trq(t, 'trayProgress', { done: p.done, total: p.total }),
    eta === null ? null : trq(t, 'trayEta', { eta: etaText(t, eta) }),
    offline ? t.quotes.trayOffline : null,
  ].filter(Boolean).join(META_SEPARATOR)
  const percent = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100)
  return (
    <section ref={element} className="qtray" aria-label={t.quotes.trayLabel} aria-live="polite">
      <div className="qtray__row">
        <span className="qtray__icon" aria-hidden="true"><Spinner size={20} /></span>
        <div className="qtray__text">
          <p className="qtray__title">{p.total === 1 ? t.quotes.trayReadingOne : trq(t, 'trayReading', { total: p.total })}</p>
          <p className="qtray__meta num">
            {meta}
            {/* Changes every second, so the tray never looks frozen, even when Reduce Motion stops the spinner (#144).
                Hidden from screen readers: in this live region it would be read out every second. */}
            <span aria-hidden="true">{META_SEPARATOR}{elapsedText(t, elapsed)}</span>
          </p>
        </div>
        <button type="button" className="qtray__btn" aria-expanded={isOpen}
          aria-label={isOpen ? t.quotes.trayHideFiles : t.quotes.trayShowFiles} onClick={() => setOpen(!isOpen)}>
          <ChevronUp size={18} className="qtray__chev" aria-hidden="true" />
        </button>
      </div>
      <div className="qtray__bar" role="progressbar" aria-label={t.quotes.trayLabel} aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}>
        <span style={{ width: `${percent}%` }} />
      </div>
      {isOpen && (
        <ul className="qtray__files">
          {p.files.map((f) => <li key={f.id}><span>{f.name}</span><span>{fileStatusText(t, f.status)}</span></li>)}
        </ul>
      )}
    </section>
  )
}
