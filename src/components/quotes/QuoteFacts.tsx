import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import type { QuoteExtraction } from '../../lib/quote-schema'

/**
 * What a quote says beyond its lines, under its checks: its date, how long it is valid and the notes the reader made of
 * what it could not place (a price that leaves tax out often ends up there). Dates are shown as the quote writes them.
 * Nothing when the quote states none of them.
 */
export function QuoteFacts({ extraction }: { extraction: QuoteExtraction | null }) {
  const { t } = useLocale()
  if (extraction === null) return null
  const dates = [
    ...(extraction.date ? [trq(t, 'quoteDated', { date: extraction.date })] : []),
    ...(extraction.validUntil ? [trq(t, 'quoteValidUntil', { date: extraction.validUntil })] : []),
  ]
  if (dates.length === 0 && extraction.notes.length === 0) return null
  return (
    <div className="qfacts qmeta">
      {dates.length > 0 && <p>{dates.join(' · ')}</p>}
      {extraction.notes.length > 0 && (
        <>
          <p>{t.quotes.readerNotes}</p>
          <ul className="qfacts__notes">{extraction.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </>
      )}
    </div>
  )
}
