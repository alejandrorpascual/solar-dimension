import { useState } from 'react'
import { useLocale } from '../../hooks/useLocale'

/** View original, and Delete behind a confirmation, since deleting also removes the file for good. */
export function QuoteActions({ quoteId, onDelete }: { quoteId: string; onDelete: () => void }) {
  const { t } = useLocale()
  const [isConfirming, setConfirming] = useState(false)
  return (
    <div className="qrow__actions">
      <a className="qbtn" href={`/api/quotes/${quoteId}/file`} target="_blank" rel="noopener noreferrer">{t.quotes.viewOriginal}</a>
      {isConfirming ? (
        <>
          <span className="qrow__confirm" role="alert">{t.quotes.deleteConfirm}</span>
          <button type="button" className="qbtn qbtn--danger" onClick={onDelete}>{t.quotes.deleteYes}</button>
          <button type="button" className="qbtn" onClick={() => setConfirming(false)}>{t.quotes.cancel}</button>
        </>
      ) : (
        <button type="button" className="qbtn" onClick={() => setConfirming(true)}>{t.quotes.deleteQuote}</button>
      )}
    </div>
  )
}
