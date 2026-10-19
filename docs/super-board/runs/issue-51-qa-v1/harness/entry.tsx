// QA harness for issue #51: mounts the real quote cards with fixture readings and the app's own stylesheet.
// Not app code; lives in the session scratchpad only.
import { createRoot } from 'react-dom/client'
import { BestCard } from '@app/components/quotes/BestCard'
import { UnrankedRow } from '@app/components/quotes/UnrankedRow'
import { compareQuotes, type QuoteView } from '@app/lib/quote-compare'
import { SAMPLE_KIT, SAMPLE_QUOTES } from '@app/lib/quote-fixtures'
import { DEFAULT_MUSTS, type KitNeeds } from '@app/lib/quote-items'
import { withOptionDefaults, type QuoteExtraction, type StoredExtraction } from '@app/lib/quote-schema'
import '@app/styles.css'

const params = new URLSearchParams(window.location.search)
const scene = params.get('scene') ?? 'best'
const KIT = SAMPLE_KIT as unknown as KitNeeds
const solartec = SAMPLE_QUOTES.solartec

const view = (extraction: QuoteExtraction, status: QuoteView['status']): QuoteView => ({
  id: 'q1', fileName: 'solartec.pdf', label: null, status, extraction, overrides: {}, totalOverride: null, createdAt: 0, retries: 0, pages: null,
})

/** What e2e/db.ts misreadQuoteLine does: the first line's unit price read as 1. */
const lineOff: QuoteExtraction = { ...solartec, lines: solartec.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 1 } : l)) }
/** What e2e/db.ts misreadQuoteCurrency does: a currency that is no ISO code. */
const badCurrency: QuoteExtraction = { ...solartec, currency: 'RD$' }
/** What e2e/db.ts stripQuoteOptions does: a reading saved before options existed, read through the API's defaults. */
const { options: _options, ...noOptions } = solartec
const stored: StoredExtraction = { ...noOptions, lines: solartec.lines.map(({ option: _option, ...l }) => l), warranties: solartec.warranties.map(({ option: _o, ...w }) => w) }

const noop = () => undefined

function Unranked({ extraction }: { extraction: QuoteExtraction }) {
  const v = compareQuotes(KIT, DEFAULT_MUSTS, [view(extraction, 'needs_review')])
  const u = v.unranked[0]!
  document.body.dataset.reason = u.reason
  return (
    <section className="qlist qunranked" aria-labelledby="qunranked-title">
      <h2 className="qpanel__title" id="qunranked-title">Waiting on you</h2>
      <div className="qunranked__grid">
        <UnrankedRow u={u} error={null} retry="retry" onRetry={noop} onDelete={noop} onTotal={noop} />
      </div>
    </section>
  )
}

function Best() {
  const v = compareQuotes(KIT, DEFAULT_MUSTS, [view(solartec, 'ready')])
  return (
    <div className="qv__grid">
      <BestCard best={v.best!} kit={KIT} error={null} retry="none" onOverride={noop} onRetry={noop} onDelete={noop} />
    </div>
  )
}

const SCENES: Record<string, () => JSX.Element> = {
  best: () => <Best />,
  'misread-lines': () => <Unranked extraction={lineOff} />,
  'misread-currency': () => <Unranked extraction={badCurrency} />,
  stored: () => <Unranked extraction={withOptionDefaults(stored)} />,
  // Edge probe: the longest description the reader keeps (300 chars, no spaces) and seven-figure amounts with cents.
  long: () => (
    <Unranked extraction={{
      ...lineOff,
      currency: 'RD$',
      lines: [
        ...lineOff.lines,
        { ...lineOff.lines[1]!, description: 'X'.repeat(300), qty: 1234.5, unitPrice: 999999.99, lineTotal: 1234567.89 },
      ],
    }} />
  ),
}

createRoot(document.getElementById('root')!).render(
  <main className="page" style={{ paddingBlock: 24 }}>
    <div className="qv">{SCENES[scene]!()}</div>
  </main>,
)
