import { Check, History } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useFocusedFieldInView } from '../hooks/useFocusedFieldInView'
import { useLocale } from '../hooks/useLocale'
import { clearRequesterDraft, saveRequesterDraft } from '../lib/persistence'
import {
  REQUESTER_COUNTRIES, REQUESTER_KINDS, REQUESTER_MAX, docRule, normalizeRequester, toDraft, validateRequester, withCountry,
  withDocInput, withKind, type Requester,
} from '../lib/requester'
import { isDirty, type DraftTarget } from '../lib/requester-draft'

export interface RequesterFormProps {
  /** Where the draft is kept: whose it is, for which project, and what it edits. */
  owner: string | null
  projectId: string
  target: DraftTarget
  /** What the form started from; Start over goes back to it, and a draft equal to it is not kept. */
  base: Requester
  /** A draft kept from a form closed without saving, with its "Save to my clients" choice; it shows the resume banner. */
  resumed: { draft: Requester; shouldRemember: boolean } | null
  /** Offer "Save to my clients" (not when editing a saved client, which Save always updates). */
  canRemember: boolean
  onSave: (requester: Requester, shouldRemember: boolean) => void
  onRemove: (() => void) | null
  onDelete: (() => void) | null
}

function Field({ id, label, isOptional = false, error, children }: { id: string; label: string; isOptional?: boolean; error?: string; children: ReactNode }) {
  const { t } = useLocale()
  return (
    <div className="rq-field">
      <label className="rq-field__label" htmlFor={id}>
        {label}
        {isOptional && <span className="rq-field__opt"> {t.requester.optional}</span>}
      </label>
      {children}
      {error && <span className="rq-err" id={`${id}-err`}>{error}</span>}
    </div>
  )
}

/** The requester's fields. Every change is kept in this browser until Save, so closing the dialog by accident loses nothing. */
export function RequesterForm({ owner, projectId, target, base, resumed, canRemember, onSave, onRemove, onDelete }: RequesterFormProps) {
  const { t } = useLocale()
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  useFocusedFieldInView(formRef, '.qdialog')
  const [draft, setDraft] = useState<Requester>(() => resumed?.draft ?? toDraft(base))
  const [isResumed, setResumed] = useState(resumed !== null)
  const [shouldRemember, setRemember] = useState(resumed?.shouldRemember ?? true)
  // Whether the last write reached storage: "Draft saved" only shows when it did.
  const [isKept, setKept] = useState(false)
  const [hasTriedSave, setTriedSave] = useState(false)
  // The draft slot is shared by every project: clear it only once this form has written to it, or opened from it.
  const ownsSlot = useRef(resumed !== null)
  const isChanged = isDirty(draft, toDraft(base))

  useEffect(() => {
    if (isChanged) {
      ownsSlot.current = true
      setKept(saveRequesterDraft({ owner, projectId, target, draft, shouldRemember }))
    } else {
      setKept(false)
      if (ownsSlot.current) clearRequesterDraft({ owner, projectId, target })
    }
  }, [draft, shouldRemember, isChanged, owner, projectId, target])

  // Errors appear after the first Save attempt, then follow the typing.
  const errors = hasTriedSave ? validateRequester(draft) : {}
  const rule = docRule(draft.kind, draft.country)
  const isCompany = draft.kind === 'company'
  const ids = { country: `${id}-country`, name: `${id}-name`, contact: `${id}-contact`, doc: `${id}-doc`, phone: `${id}-phone`, email: `${id}-email`, address: `${id}-address` }
  const invalid = (field: 'name' | 'doc' | 'email', inputId: string) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${inputId}-err` } : {}

  /** Leaves the form on purpose: the draft goes with it. */
  const leave = (then: () => void) => () => {
    ownsSlot.current = false
    clearRequesterDraft({ owner, projectId, target })
    then()
  }

  const startOver = () => {
    setDraft(toDraft(base))
    setResumed(false)
    setTriedSave(false)
    // The banner and its button go away; without a new focus the dialog loses it, and Escape with it.
    requestAnimationFrame(() => document.getElementById(ids.name)?.focus())
  }

  const save = () => {
    setTriedSave(true)
    const clean = normalizeRequester(draft)
    if (!clean) {
      // The errors render on the next frame; moving focus to the first one is what makes a screen reader announce it.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    leave(() => onSave(clean, canRemember && shouldRemember))()
  }

  return (
    <form ref={formRef} className="rq-form" noValidate onSubmit={(e) => { e.preventDefault(); save() }}>
      {isChanged && isKept && (
        <p className="rq-saved"><Check size={14} aria-hidden="true" />{t.requester.draftSaved}</p>
      )}
      {isResumed && (
        <div className="rq-resume" role="status">
          <span className="rq-resume__icon" aria-hidden="true"><History size={18} /></span>
          <div className="rq-resume__text">
            <strong>{t.requester.resumeTitle}</strong>
            <span>{t.requester.resumeBody}</span>
            <button type="button" className="rq-linkbtn" onClick={startOver}>{t.requester.startOver}</button>
          </div>
        </div>
      )}

      <div className="rq-kinds" role="group" aria-label={t.requester.kindLabel}>
        {REQUESTER_KINDS.map((kind) => (
          <button key={kind} type="button" className={`seg${draft.kind === kind ? ' seg--on' : ''}`} aria-pressed={draft.kind === kind} onClick={() => setDraft(withKind(draft, kind))}>
            {t.requester[kind]}
          </button>
        ))}
      </div>

      <Field id={ids.country} label={t.requester.country}>
        <select
          id={ids.country}
          className="in"
          value={draft.country}
          onChange={(e) => setDraft(withCountry(draft, REQUESTER_COUNTRIES.find((c) => c === e.target.value) ?? draft.country))}
        >
          {REQUESTER_COUNTRIES.map((c) => <option key={c} value={c}>{t.requester[`country${c}`]}</option>)}
        </select>
      </Field>

      <Field id={ids.name} label={isCompany ? t.requester.nameCompany : t.requester.namePerson} error={errors.name && t.requester[errors.name]}>
        <input
          id={ids.name} className="in" type="text" maxLength={REQUESTER_MAX.name} autoComplete={isCompany ? 'organization' : 'name'}
          placeholder={isCompany ? t.requester.nameCompanyHint : t.requester.namePersonHint}
          value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} {...invalid('name', ids.name)}
        />
      </Field>

      {isCompany && (
        <Field id={ids.contact} label={t.requester.contact} isOptional>
          <input
            id={ids.contact} className="in" type="text" maxLength={REQUESTER_MAX.contact} autoComplete="name" placeholder={t.requester.contactHint}
            value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
          />
        </Field>
      )}

      {rule === null && <p className="rq-note">{t.requester.noIdUS}</p>}
      {rule && (
        <Field id={ids.doc} label={t.requester[rule.field]} isOptional={rule.isOptional} error={errors.doc && t.requester[errors.doc]}>
          <div className={rule.prefixLabel ? 'rq-doc' : undefined}>
            {rule.prefixLabel && (
              <select className="in" aria-label={t.requester[rule.prefixLabel]} value={draft.docPrefix} onChange={(e) => setDraft({ ...draft, docPrefix: e.target.value })}>
                {rule.prefixes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <input
              id={ids.doc} className="in" type="text" maxLength={REQUESTER_MAX.doc} inputMode={rule.prefixLabel ? 'numeric' : 'text'}
              placeholder={rule.placeholder} value={draft.doc} onChange={(e) => setDraft(withDocInput(draft, e.target.value))} {...invalid('doc', ids.doc)}
            />
          </div>
        </Field>
      )}

      <Field id={ids.phone} label={t.requester.phone}>
        <input
          id={ids.phone} className="in" type="tel" maxLength={REQUESTER_MAX.phone} autoComplete="tel" placeholder={t.requester[`phonePh${draft.country}`]}
          value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
        />
      </Field>
      <Field id={ids.email} label={t.requester.email} isOptional error={errors.email && t.requester[errors.email]}>
        <input
          id={ids.email} className="in" type="email" maxLength={REQUESTER_MAX.email} autoComplete="email"
          value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} {...invalid('email', ids.email)}
        />
      </Field>
      <Field id={ids.address} label={t.requester.address} isOptional>
        <input
          id={ids.address} className="in" type="text" maxLength={REQUESTER_MAX.address} autoComplete="street-address" placeholder={t.requester.addressHint}
          value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        />
      </Field>

      {canRemember && (
        <label className="dl__check">
          <input type="checkbox" checked={shouldRemember} onChange={() => setRemember(!shouldRemember)} />
          {t.requester.remember}
        </label>
      )}
      <div className="qdialog__actions">
        {onRemove && <button type="button" className="btn" onClick={leave(onRemove)}>{t.requester.remove}</button>}
        <button type="submit" className="btn btn--primary">{t.requester.save}</button>
      </div>
      {onDelete && <button type="button" className="rq-linkbtn rq-linkbtn--danger" onClick={leave(onDelete)}>{t.requester.deleteClient}</button>}
    </form>
  )
}
