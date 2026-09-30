import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useCatalog } from '../../hooks/useCatalog'
import { useLocale } from '../../hooks/useLocale'
import { useQuoteJobs } from '../../hooks/useQuoteJobs'
import { trq } from '../../i18n'
import { computeProject } from '../../lib/project-summary'
import { compareQuotes } from '../../lib/quote-compare'
import { canRetry } from '../../lib/quote-guards'
import { kitNeeds, setOverride, type ItemId, type Musts, type Override, type Overrides } from '../../lib/quote-items'
import type { Rejection } from '../../lib/quote-limits'
import {
  addPendingMust, addPendingOverride, NO_PENDING, overlayPending, prunePending, settlePendingMust, settlePendingOverride,
  type PendingEdits,
} from '../../lib/quote-pending'
import { rejectionText } from '../../lib/quote-text'
import { deleteQuote, retryQuote, setQuoteMust, setQuoteOverride, setQuoteTotal, type ProjectQuotes } from '../../server/quotes/api'
import { BestCard } from './BestCard'
import { MustsSheet } from './MustsSheet'
import { PricePlot } from './PricePlot'
import { QuoteRow } from './QuoteRow'
import { UnrankedRow } from './UnrankedRow'
import { verdictClock } from './verdict-clock'
import { VerdictHeader } from './VerdictHeader'

/** The page's data, with the clock tick at which the loader requested it (0 when it was read on the server). */
export type VerdictData = ProjectQuotes & { readAt: number }

interface Props {
  data: VerdictData
  progress: { done: number; total: number } | null
  onReload: () => Promise<void>
  /** The upload button (Task 16); the footer shows it next to Change must-haves. */
  footerExtra?: ReactNode
}

type SaveError = { key: string; text: string } | null
const overridesById = (d: ProjectQuotes): Record<string, Overrides> => Object.fromEntries(d.quotes.map((q) => [q.id, q.overrides]))
const serverEdits = (d: ProjectQuotes) => ({ musts: d.musts, overrides: overridesById(d) })

/** The verdict, recomputed on every change from the server's quotes, this project's kit and its must-haves. */
export function VerdictView({ data, progress, onReload, footerExtra }: Props) {
  const { t } = useLocale()
  const catalog = useCatalog()
  const { refresh } = useQuoteJobs()
  const [musts, setMusts] = useState<Musts>(data.musts)
  const [overrides, setOverrides] = useState(() => overridesById(data))
  const [error, setError] = useState<SaveError>(null)
  const [isMustsOpen, setMustsOpen] = useState(false)
  // Edits still saving, or saved after the latest reload was requested. A reload (a quote finished, another action) can
  // bring data read before a save landed; laying these over it keeps the change the user sees. An edit is dropped only
  // by data whose request came after its save answered.
  const pending = useRef<PendingEdits>(NO_PENDING)
  const nextSeq = useRef(0)
  useEffect(() => {
    pending.current = prunePending(pending.current, data.readAt)
    const shown = overlayPending(serverEdits(data), pending.current)
    setMusts(shown.musts)
    setOverrides(shown.overrides)
  }, [data])

  const result = computeProject(data.project, catalog)
  const back = (
    <Link className="qlink qv__back" to="/" search={{ step: 3 }}>
      <ArrowLeft size={16} aria-hidden="true" />{trq(t, 'backToKit', { project: data.project.name })}
    </Link>
  )
  // An empty kit asks nothing of a quote, so there is nothing to compare against: no ranking, no best fit, only a note.
  if (result.empty) {
    return (
      <div className="qv">
        {back}
        <header className="qv__head">
          <h1 className="qv__title">{t.quotes.kitEmptyTitle}</h1>
          <p className="qv__sub">{t.quotes.kitEmptyNote}</p>
        </header>
      </div>
    )
  }
  const kit = kitNeeds(result)
  const verdict = compareQuotes(kit, musts, data.quotes.map((q) => ({ ...q, overrides: overrides[q.id] ?? q.overrides })))
  const failed = (key: string) => setError({ key, text: t.quotes.saveFailed })
  const errorFor = (key: string) => (error?.key === key ? error.text : null)

  /** Records that a save answered. True when it was the item's latest edit, so a rollback may apply. */
  const settle = (next: (p: PendingEdits) => PendingEdits): boolean => {
    const before = pending.current
    pending.current = next(before)
    return pending.current !== before
  }
  // A failed save rolls back only the value it changed, so another change that saved in the meantime is kept. A newer
  // edit of the same item still saving is kept too.
  const onOverride = (quoteId: string) => async (item: ItemId, value: Override | null) => {
    const prev = overrides[quoteId]?.[item] ?? null
    const seq = ++nextSeq.current
    setError(null)
    pending.current = addPendingOverride(pending.current, quoteId, item, value, seq)
    setOverrides((o) => ({ ...o, [quoteId]: setOverride(o[quoteId] ?? {}, item, value) }))
    try {
      await setQuoteOverride({ data: { quoteId, item, value } })
      settle((p) => settlePendingOverride(p, quoteId, item, seq, value, verdictClock.tick()))
    } catch (e) {
      console.error('[quotes] saving an override failed', { quoteId, item, e })
      if (settle((p) => settlePendingOverride(p, quoteId, item, seq, prev, verdictClock.tick()))) {
        setOverrides((o) => ({ ...o, [quoteId]: setOverride(o[quoteId] ?? {}, item, prev) }))
      }
      failed(quoteId)
    }
  }
  // Each switch saves only its own item, so the server and the screen agree on which changes were kept.
  const onMust = async (item: ItemId, value: boolean) => {
    const prev = musts[item]
    const seq = ++nextSeq.current
    setError(null)
    pending.current = addPendingMust(pending.current, item, value, seq)
    setMusts((m) => ({ ...m, [item]: value }))
    try {
      await setQuoteMust({ data: { projectId: data.project.id, item, value } })
      settle((p) => settlePendingMust(p, item, seq, value, verdictClock.tick()))
    } catch (e) {
      console.error('[quotes] saving a must-have failed', { item, e })
      if (settle((p) => settlePendingMust(p, item, seq, prev, verdictClock.tick()))) setMusts((m) => ({ ...m, [item]: prev }))
      failed('musts')
    }
  }
  /** A server action followed by a reload of this page and of the tray. A refusal (a retry over a limit) shows its reason. */
  const run = (key: string, task: () => Promise<{ ok: true } | { ok: false; rejection: Rejection }>) => async () => {
    setError(null)
    try {
      const res = await task()
      if (!res.ok) {
        setError({ key, text: rejectionText(t, res.rejection) })
        return
      }
      await Promise.all([onReload(), refresh()])
    } catch (e) {
      console.error('[quotes] action failed', { key, e })
      failed(key)
    }
  }
  const remove = (quoteId: string) => run(quoteId, () => deleteQuote({ data: { quoteId } }))
  const canRetryQuote = (quoteId: string) => {
    const q = data.quotes.find((x) => x.id === quoteId)
    return q !== undefined && canRetry(q)
  }
  const others = verdict.best ? verdict.ranked.filter((r) => r.quote.id !== verdict.best?.quote.id) : verdict.ranked

  return (
    <div className="qv">
      {back}
      <VerdictHeader verdict={verdict} kit={kit} progress={progress} />
      {verdict.best && (
        <div className="qv__grid">
          <BestCard best={verdict.best} nextFit={verdict.nextFit} kit={kit} error={errorFor(verdict.best.quote.id)}
            onOverride={onOverride(verdict.best.quote.id)} onDelete={remove(verdict.best.quote.id)} />
          {verdict.ranked.length > 1 && <PricePlot verdict={verdict} />}
        </div>
      )}
      {(others.length > 0 || verdict.unranked.length > 0) && (
        <section className="qlist" aria-labelledby="qlist-title">
          <h2 className="qpanel__title" id="qlist-title">{verdict.best ? t.quotes.othersTitle : t.quotes.allTitle}</h2>
          <div className="qlist__rows">
            {others.map((r) => (
              <QuoteRow key={r.quote.id} r={r} verdict={verdict} kit={kit} error={errorFor(r.quote.id)}
                onOverride={onOverride(r.quote.id)} onDelete={remove(r.quote.id)} />
            ))}
            {verdict.unranked.map((u) => (
              <UnrankedRow key={u.quote.id} u={u} error={errorFor(u.quote.id)} canRetry={canRetryQuote(u.quote.id)}
                onRetry={run(u.quote.id, () => retryQuote({ data: { quoteId: u.quote.id } }))}
                onDelete={remove(u.quote.id)}
                onTotal={(total) => void run(u.quote.id, () => setQuoteTotal({ data: { quoteId: u.quote.id, total } }))()} />
            ))}
          </div>
        </section>
      )}
      <footer className="qfoot">
        <p className="fine muted">{t.quotes.finePrint}</p>
        <div className="qfoot__actions">
          <button type="button" className="qbtn" onClick={() => setMustsOpen(true)}>{t.quotes.changeMusts}</button>
          {footerExtra}
        </div>
      </footer>
      <MustsSheet isOpen={isMustsOpen} onOpenChange={setMustsOpen} musts={musts} onChange={(i, v) => void onMust(i, v)} error={errorFor('musts')} />
    </div>
  )
}
