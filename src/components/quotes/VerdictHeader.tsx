import { Check, TriangleAlert } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import type { Verdict } from '../../lib/quote-compare'
import type { KitNeeds } from '../../lib/quote-items'
import { verdictHeading, verdictStatus, verdictSubline } from '../../lib/quote-text'

interface Props { verdict: Verdict; kit: KitNeeds; progress: { done: number; total: number } | null }

export function VerdictHeader({ verdict, kit, progress }: Props) {
  const { t } = useLocale()
  const isReading = progress !== null && progress.done < progress.total
  const status = isReading ? null : verdictStatus(t, verdict)
  const sub = verdictSubline(t, verdict, kit)
  return (
    <header className="qv__head">
      <div className="qv__status" role="status">
        {isReading && progress && <span className="qpill qpill--run">{trq(t, 'trayProgress', { done: progress.done, total: progress.total })}</span>}
        {status && (
          <>
            <span className={status.tone === 'ok' ? 'qpill qpill--ok' : 'qpill qpill--warn'}>
              {status.tone === 'ok' ? <Check size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />}{status.label}
            </span>
            {status.meta && <span className="qmeta">{status.meta}</span>}
          </>
        )}
      </div>
      <h1 className="qv__title">{verdictHeading(t, verdict)}</h1>
      {sub && <p className="qv__sub">{sub}</p>}
    </header>
  )
}
