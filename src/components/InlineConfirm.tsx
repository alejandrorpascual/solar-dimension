import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../hooks/useLocale'

interface Props {
  question: string
  /** The label of the answer that goes ahead, such as "Delete it". The other answer is always Cancel. */
  yes: string
  onYes: () => void
  onCancel: () => void
  /**
   * `card`: the question above its answers, on a tinted panel of its own. `row`: the question and its answers as
   * siblings, laid out by the caller's own row.
   */
  look: 'card' | 'row'
}

/**
 * The question asked in place before something that cannot be undone. It is announced as it appears, and focus starts
 * on Cancel, the safe answer, because the control that asked has just gone away.
 */
export function InlineConfirm({ question, yes, onYes, onCancel, look }: Props) {
  const { t } = useLocale()
  const cancelRef = useRef<HTMLButtonElement>(null)
  // In an effect, not autoFocus: right after a ··· menu action the page around the menu is still `inert` while React
  // commits, and react-aria lifts that in the menu's cleanup, which runs before any new effect (see useTitleFocus).
  useEffect(() => { cancelRef.current?.focus() }, [])
  const answers = (
    <>
      <button type="button" className="qbtn qbtn--danger" onClick={onYes}>{yes}</button>
      <button ref={cancelRef} type="button" className="qbtn" onClick={onCancel}>{t.quotes.cancel}</button>
    </>
  )
  if (look === 'row') return <><span className="qrow__confirm" role="alert">{question}</span>{answers}</>
  return (
    <div className="pcard__confirm">
      <p className="pcard__ask" role="alert">{question}</p>
      <div className="pcard__answers">{answers}</div>
    </div>
  )
}

/**
 * For a button that asks in its own place: whether it is asking, and a ref for the button, which takes focus back
 * once Cancel brings it back, so the keyboard is not left on the page.
 */
export function useAskFirst() {
  const askerRef = useRef<HTMLButtonElement>(null)
  const [state, setState] = useState<'idle' | 'asking' | 'cancelled'>('idle')
  useEffect(() => {
    if (state === 'cancelled') askerRef.current?.focus()
  }, [state])
  return { isAsking: state === 'asking', askerRef, ask: () => setState('asking'), cancel: () => setState('cancelled') }
}
