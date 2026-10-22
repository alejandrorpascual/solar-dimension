import { useLocale } from '../../hooks/useLocale'
import { deleteConfirmText } from '../../lib/quote-text'
import { InlineConfirm, useAskFirst } from '../InlineConfirm'

/** View original, and Delete behind a confirmation, since deleting also removes the file, and every option's card, for good. */
export function QuoteActions({ quoteId, optionCount, onDelete }: { quoteId: string; optionCount: number; onDelete: () => void }) {
  const { t } = useLocale()
  const { isAsking, askerRef, ask, cancel } = useAskFirst()
  return (
    <div className="qrow__actions">
      <a className="qbtn" href={`/api/quotes/${quoteId}/file`} target="_blank" rel="noopener noreferrer">{t.quotes.viewOriginal}</a>
      {isAsking ? (
        <InlineConfirm look="row" question={deleteConfirmText(t, optionCount)} yes={t.quotes.deleteYes} onYes={onDelete} onCancel={cancel} />
      ) : (
        <button ref={askerRef} type="button" className="qbtn" onClick={ask}>{t.quotes.deleteQuote}</button>
      )}
    </div>
  )
}
