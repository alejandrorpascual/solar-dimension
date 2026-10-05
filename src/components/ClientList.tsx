import { Pencil, Plus } from 'lucide-react'
import { useId } from 'react'
import { useLocale } from '../hooks/useLocale'
import { requesterInitials, type Requester } from '../lib/requester'
import type { SavedClient } from '../lib/saved-clients'
import { useRequesterSubline } from './RequesterCard'

/** A list choice: a saved client's id, or the project's own requester when it matches none of them. */
export type ClientChoice = string
export const PROJECT_CHOICE: ClientChoice = 'project'

interface Props {
  clients: readonly SavedClient[]
  /** The project's requester when no saved client matches it; it gets its own first row. */
  projectOnly: Requester | null
  selected: ClientChoice | null
  onSelect: (choice: ClientChoice) => void
  onEdit: (choice: ClientChoice) => void
  onNew: () => void
  onUse: () => void
  onRemove: (() => void) | null
}

/** Saved clients as one-tap choices for the spec sheet, with the way to a new one. */
export function ClientList({ clients, projectOnly, selected, onSelect, onEdit, onNew, onUse, onRemove }: Props) {
  const { t } = useLocale()
  const name = useId()
  const subline = useRequesterSubline()
  const rows = [
    ...(projectOnly ? [{ choice: PROJECT_CHOICE, requester: projectOnly, isProjectOnly: true }] : []),
    ...clients.map((c) => ({ choice: c.id, requester: c.requester, isProjectOnly: false })),
  ]

  return (
    <div className="rq-form">
      <div className="rq-list" role="radiogroup" aria-label={t.requester.listLabel}>
        {rows.map(({ choice, requester, isProjectOnly }) => (
          <div key={choice} className={`rq-row${selected === choice ? ' rq-row--on' : ''}`}>
            <label className="rq-row__pick">
              <input type="radio" name={name} value={choice} checked={selected === choice} onChange={() => onSelect(choice)} />
              <span className="rq-mark" aria-hidden="true">{requesterInitials(requester.name)}</span>
              <span className="rq-text">
                <strong>{requester.name}</strong>
                <span className="rq-text__sub">{isProjectOnly ? t.requester.onlyHere : subline(requester)}</span>
              </span>
            </label>
            <button type="button" className="rq-row__edit" aria-label={`${t.requester.edit}: ${requester.name}`} onClick={() => onEdit(choice)}>
              <Pencil size={18} aria-hidden="true" />
            </button>
          </div>
        ))}
        <button type="button" className="rq-new" onClick={onNew}>
          <span className="rq-mark rq-mark--add" aria-hidden="true"><Plus size={20} /></span>
          {t.requester.newClient}
        </button>
      </div>
      <div className="qdialog__actions">
        {onRemove && <button type="button" className="btn" onClick={onRemove}>{t.requester.removeFromSheet}</button>}
        <button type="button" className="btn btn--primary" disabled={selected === null} onClick={onUse}>{t.requester.useOnSheet}</button>
      </div>
    </div>
  )
}
