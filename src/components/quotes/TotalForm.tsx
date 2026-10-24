import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAskFirst } from '../InlineConfirm'
import { useLocale } from '../../hooks/useLocale'
import { parseTotal } from '../../lib/quote-guards'

interface Props {
  /** What the field is for, above it. */
  children?: ReactNode
  onTotal: (total: number) => void
  /** Given when Change opened the form: it then takes focus as it opens, and offers Cancel. */
  onCancel?: () => void
}

/**
 * The field for a quote's total, saved only when it reads as an amount (parseTotal). It starts empty, beside the total
 * that was read: saving the figure that failed the check takes typing it.
 */
export function TotalForm({ children, onTotal, onCancel }: Props) {
  const { t } = useLocale()
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [total, setTotal] = useState('')
  const [isInvalid, setInvalid] = useState(false)
  const isOpenedByChange = onCancel !== undefined
  useEffect(() => {
    if (isOpenedByChange) inputRef.current?.focus()
  }, [isOpenedByChange])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = parseTotal(total)
    setInvalid(n === null)
    if (n !== null) onTotal(n)
  }
  return (
    <form className="qrow__form" onSubmit={submit}>
      {children}
      <label htmlFor={inputId}>{t.quotes.totalInQuote}
        <input ref={inputRef} id={inputId} className="in num" inputMode="decimal" value={total} aria-invalid={isInvalid || undefined}
          aria-describedby={isInvalid ? errorId : undefined}
          onChange={(e) => {
            setTotal(e.target.value)
            setInvalid(false)
          }} />
      </label>
      <button type="submit" className="qbtn">{t.quotes.save}</button>
      {onCancel && <button type="button" className="qbtn" onClick={onCancel}>{t.quotes.cancel}</button>}
      {isInvalid && <p className="qerr" id={errorId} role="alert" style={{ flexBasis: '100%' }}>{t.quotes.totalInvalid}</p>}
    </form>
  )
}

/** A ranked quote's note that it ranks on the total the user typed, with Change to type another one. */
export function TypedTotal({ onTotal }: { onTotal: (total: number) => void }) {
  const { t } = useLocale()
  // Cancel, or a save, closes the form and gives focus back to Change, so the keyboard is not left on the page.
  const { isAsking: isChanging, askerRef, ask, cancel } = useAskFirst()
  if (isChanging) {
    return (
      <TotalForm onCancel={cancel} onTotal={(n) => {
        cancel()
        onTotal(n)
      }} />
    )
  }
  return (
    <div className="qtyped">
      <p className="qmeta">{t.quotes.totalTyped}</p>
      <button ref={askerRef} type="button" className="qlink" onClick={ask}>{t.quotes.changeTotal}</button>
    </div>
  )
}
