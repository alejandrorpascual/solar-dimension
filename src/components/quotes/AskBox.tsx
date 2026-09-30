import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import type { RankedQuote, Verdict } from '../../lib/quote-compare'
import { askText, questionText } from '../../lib/quote-text'

/** "Worth asking" note with a ready-made question. If the clipboard is blocked, the question is shown to copy by hand. */
export function AskBox({ r, verdict }: { r: RankedQuote; verdict: Verdict }) {
  const { t } = useLocale()
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const question = questionText(t, r)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(question)
      setCopy('done')
    } catch (error) {
      console.error('[quotes] copying the question failed', error)
      setCopy('failed')
    }
  }
  return (
    <div className="qask" role="note">
      <TriangleAlert size={18} aria-hidden="true" />
      <div className="qask__body">
        <p><strong>{t.quotes.askTitle}:</strong> {askText(t, r, verdict)}</p>
        {copy === 'failed' ? (
          <p>{t.quotes.copyFailed} <span className="qask__question">{question}</span></p>
        ) : (
          <button type="button" className="qask__copy" onClick={() => void onCopy()}>
            {copy === 'done' ? t.quotes.copied : t.quotes.copyQuestion}
          </button>
        )}
      </div>
    </div>
  )
}
