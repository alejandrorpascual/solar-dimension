import { Plus } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { formatDoc, requesterInitials, type Requester } from '../lib/requester'

interface Props { requester: Requester | null; isDisabled: boolean; onOpen: () => void }

/** Who the spec sheet is for: an add button until there is a requester, then their name, ID and phone with Change. */
/** A requester's second line: their printed ID (or kind, without one) and phone. */
export function useRequesterSubline(): (requester: Requester) => string {
  const { t } = useLocale()
  return (r) => {
    const doc = formatDoc(r)
    return [doc ? `${t.requester[doc.label]} ${doc.value}` : t.requester[r.kind], r.phone].filter(Boolean).join(' · ')
  }
}

export function RequesterCard({ requester, isDisabled, onOpen }: Props) {
  const { t } = useLocale()
  const subline = useRequesterSubline()
  if (!requester) {
    return (
      <button type="button" className="rq-add" disabled={isDisabled} onClick={onOpen}>
        <span className="rq-mark rq-mark--add" aria-hidden="true"><Plus size={20} /></span>
        <span className="rq-text"><strong>{t.requester.add}</strong><span className="rq-text__sub">{t.requester.addHint}</span></span>
      </button>
    )
  }
  const sub = subline(requester)
  return (
    <div className="rq-card">
      <span className="rq-mark" aria-hidden="true">{requesterInitials(requester.name)}</span>
      <span className="rq-text"><strong>{requester.name}</strong><span className="rq-text__sub">{sub}</span></span>
      <button type="button" className="btn rq-card__edit" disabled={isDisabled} aria-label={`${t.requester.change}: ${requester.name}`} onClick={onOpen}>
        {t.requester.change}
      </button>
    </div>
  )
}
