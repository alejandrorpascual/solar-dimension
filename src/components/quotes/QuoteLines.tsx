import { useLocale } from '../../hooks/useLocale'
import { lineRows } from '../../lib/quote-line-text'
import type { QuoteExtraction } from '../../lib/quote-schema'

interface Props { extraction: QuoteExtraction | null; optionId: string | null }

/**
 * Every line read for a quote, or for one of its options, with its quantity, unit price and line total: what its checks
 * were run on. Nothing when no line was read.
 */
export function QuoteLines({ extraction, optionId }: Props) {
  const { t } = useLocale()
  const rows = extraction === null ? [] : lineRows(t, extraction, optionId)
  if (rows.length === 0) return null
  const q = t.quotes
  return (
    <table className="qlines">
      <caption className="qlines__title">{q.linesTitle}</caption>
      <thead>
        <tr>
          <th scope="col">{q.lineItem}</th>
          <th scope="col" className="qlines__n">{q.lineQty}</th>
          <th scope="col" className="qlines__n">{q.lineUnitPrice}</th>
          <th scope="col" className="qlines__n">{q.lineTotal}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.description}</td>
            <td className="qlines__n num">{r.qty}</td>
            <td className="qlines__n num">{r.unitPrice}</td>
            <td className="qlines__n num">{r.lineTotal}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
