import { X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import { forgetRequester, loadRememberedRequester, rememberRequester } from '../lib/persistence'
import {
  REQUESTER_COUNTRIES, REQUESTER_KINDS, REQUESTER_MAX, defaultCountry, docRule, emptyRequester, normalizeRequester,
  validateRequester, withCountry, withDocInput, withKind, type Requester,
} from '../lib/requester'

interface Props {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The open project's requester; null opens the one remembered on this device, or a blank form. */
  requester: Requester | null
  onSave: (requester: Requester) => void
  onRemove: () => void
}

/** The requester's details in a dialog (a bottom sheet on phones). Nothing reaches the project until Save. */
export function RequesterSheet({ isOpen, onOpenChange, requester, onSave, onRemove }: Props) {
  const { t } = useLocale()
  return (
    <ModalOverlay className="qdialog__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="qdialog">
        <Dialog className="qdialog__body">
          {({ close }) => (
            <>
              <button type="button" className="qdialog__close" aria-label={t.requester.close} onClick={close}><X size={16} aria-hidden="true" /></button>
              <Heading slot="title" className="qdialog__title">{t.requester.sheetTitle}</Heading>
              <p className="qdialog__text">{t.requester.sheetHelp}</p>
              <RequesterForm
                initial={requester}
                onSave={(saved) => { onSave(saved); close() }}
                onRemove={requester ? () => { onRemove(); close() } : null}
              />
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
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

/** Mounted each time the dialog opens, so the draft starts from the saved requester every time. */
function RequesterForm({ initial, onSave, onRemove }: { initial: Requester | null; onSave: (r: Requester) => void; onRemove: (() => void) | null }) {
  const { t, locale } = useLocale()
  const id = useId()
  const [draft, setDraft] = useState<Requester>(() => initial ?? loadRememberedRequester() ?? emptyRequester(defaultCountry(locale)))
  const [shouldRemember, setRemember] = useState(true)
  const [hasTriedSave, setTriedSave] = useState(false)
  // Errors appear after the first Save attempt, then follow the typing.
  const errors = hasTriedSave ? validateRequester(draft) : {}
  const rule = docRule(draft.kind, draft.country)
  const isCompany = draft.kind === 'company'
  const ids = { country: `${id}-country`, name: `${id}-name`, contact: `${id}-contact`, doc: `${id}-doc`, phone: `${id}-phone`, email: `${id}-email`, address: `${id}-address` }
  const invalid = (field: 'name' | 'doc' | 'email', inputId: string) =>
    errors[field] ? { 'aria-invalid': true, 'aria-describedby': `${inputId}-err` } : {}

  const save = () => {
    setTriedSave(true)
    const clean = normalizeRequester(draft)
    if (!clean) return
    if (shouldRemember) rememberRequester(clean)
    else forgetRequester()
    onSave(clean)
  }

  return (
    <form className="rq-form" noValidate onSubmit={(e) => { e.preventDefault(); save() }}>
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

      <label className="dl__check">
        <input type="checkbox" checked={shouldRemember} onChange={() => setRemember(!shouldRemember)} />
        {t.requester.remember}
      </label>
      <div className="qdialog__actions">
        {onRemove && <button type="button" className="btn" onClick={onRemove}>{t.requester.remove}</button>}
        <button type="submit" className="btn btn--primary">{t.requester.save}</button>
      </div>
    </form>
  )
}
