import { useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { LOAD_KINDS, SURGE_CLASSES } from '../../lib/catalog'
import { APPLIANCE_CATEGORIES, ApplianceSchema, applianceWarnings, idTakenMessage, slugify, type ApplianceRecord } from '../../lib/catalog-schema'
import { adminSaveAppliance } from '../../server/admin-catalog'

type Draft = Record<'nameEn' | 'noteEn' | 'nameEs' | 'noteEs' | 'category' | 'watts' | 'surge' | 'duty' | 'tons' | 'acType' | 'kind' | 'surgeClass' | 'burstSeconds' | 'cyclesPerHour', string>

const toDraft = (r: ApplianceRecord | null): Draft => ({
  nameEn: r?.labels.en.name ?? '', noteEn: r?.labels.en.note ?? '', nameEs: r?.labels.es.name ?? '', noteEs: r?.labels.es.note ?? '',
  category: r?.category ?? 'Kitchen', watts: String(r?.watts ?? ''), surge: String(r?.surge ?? ''), duty: String(r?.duty ?? ''),
  tons: r?.tons != null ? String(r.tons) : '', acType: r?.acType ?? '',
  kind: r?.kind ?? '', surgeClass: r?.surgeClass ?? '',
  burstSeconds: r?.burstSeconds != null ? String(r.burstSeconds) : '', cyclesPerHour: r?.cyclesPerHour != null ? String(r.cyclesPerHour) : '',
})

function toInput(d: Draft, id: string) {
  const isAc = d.category === 'Air conditioning'
  const isMomentary = d.kind === 'momentary'
  return {
    id, category: d.category, watts: Number(d.watts), surge: Number(d.surge), duty: Number(d.duty),
    tons: isAc && d.tons ? Number(d.tons) : null, acType: isAc && d.acType ? d.acType : null,
    kind: d.kind || null, surgeClass: d.surgeClass || null,
    burstSeconds: isMomentary && d.burstSeconds ? Number(d.burstSeconds) : null,
    cyclesPerHour: isMomentary && d.cyclesPerHour ? Number(d.cyclesPerHour) : null,
    labels: { en: { name: d.nameEn, note: d.noteEn }, es: { name: d.nameEs, note: d.noteEs } },
  }
}

/** Fields the form renders its own inline error for; anything else falls back to a generic line so no issue is silently dropped. */
const MAPPED_ERROR_KEYS = new Set([
  'id', 'idTaken', 'labels.en.name', 'labels.en.note', 'labels.es.name', 'labels.es.note', 'category', 'watts', 'surge', 'duty', 'tons',
  'kind', 'surgeClass', 'burstSeconds', 'cyclesPerHour',
])

export function ApplianceForm({
  initial,
  existingIds,
  onSaved,
  onCancel,
}: {
  initial: ApplianceRecord | null
  existingIds: ReadonlySet<string>
  onSaved: () => Promise<void> | void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)
  const mode: 'create' | 'update' = initial ? 'update' : 'create'
  const id = initial?.id ?? slugify(draft.nameEn)
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value })
  const parsed = ApplianceSchema.safeParse(toInput(draft, id))
  const warnings = parsed.success ? applianceWarnings(parsed.data) : []
  const unmappedErrors = Object.entries(errors).filter(([k]) => !MAPPED_ERROR_KEYS.has(k))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])))
      return
    }
    if (mode === 'create') {
      const taken = idTakenMessage(id, existingIds)
      if (taken) {
        setErrors({ idTaken: taken })
        return
      }
    }
    setSaving(true)
    try {
      await adminSaveAppliance({ data: { mode, item: parsed.data } })
      await onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, k: keyof Draft, errKey: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="admin__field">
      <span>{label}</span>
      <input value={draft[k]} onChange={set(k)} aria-invalid={!!errors[errKey]} {...props} />
      {errors[errKey] && <small className="admin__error">{errors[errKey]}</small>}
    </label>
  )

  return (
    <form className="admin__form" onSubmit={submit} noValidate>
      <p className="admin__id">
        id: <code>{id || '—'}</code>{!initial && ' (fixed after saving)'}
        {errors.id && <><br /><small className="admin__error">The English name must give an id of at least 2 letters or digits</small></>}
        {errors.idTaken && <><br /><small className="admin__error">{errors.idTaken}</small></>}
      </p>
      {field('Name (EN)', 'nameEn', 'labels.en.name')}
      {field('Note (EN)', 'noteEn', 'labels.en.note')}
      {field('Name (ES)', 'nameEs', 'labels.es.name')}
      {field('Note (ES)', 'noteEs', 'labels.es.note')}
      <label className="admin__field">
        <span>Category</span>
        <select value={draft.category} onChange={set('category')}>
          {APPLIANCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {errors.category && <small className="admin__error">{errors.category}</small>}
      </label>
      {field('Running watts', 'watts', 'watts', { inputMode: 'numeric' })}
      {field('Surge watts', 'surge', 'surge', { inputMode: 'numeric' })}
      {field('Duty', 'duty', 'duty', { inputMode: 'decimal' })}
      {draft.category === 'Air conditioning' && (
        <>
          {field('Tons', 'tons', 'tons', { inputMode: 'decimal' })}
          <label className="admin__field">
            <span>Compressor</span>
            <select value={draft.acType} onChange={set('acType')}>
              <option value="">—</option><option value="inverter">inverter</option><option value="conventional">conventional</option>
            </select>
          </label>
        </>
      )}
      <label className="admin__field">
        <span>Load kind</span>
        <select value={draft.kind} onChange={set('kind')} aria-invalid={!!errors.kind}>
          <option value="">auto (from duty)</option>
          {LOAD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {errors.kind && <small className="admin__error">{errors.kind}</small>}
      </label>
      <label className="admin__field">
        <span>Surge class</span>
        <select value={draft.surgeClass} onChange={set('surgeClass')} aria-invalid={!!errors.surgeClass}>
          <option value="">auto (from surge ratio)</option>
          {SURGE_CLASSES.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {errors.surgeClass && <small className="admin__error">{errors.surgeClass}</small>}
      </label>
      {draft.kind === 'momentary' && (
        <>
          {field('Burst seconds', 'burstSeconds', 'burstSeconds', { inputMode: 'decimal' })}
          {field('Cycles per hour', 'cyclesPerHour', 'cyclesPerHour', { inputMode: 'decimal' })}
          <p className="admin__hint">The engine uses burst × cycles ÷ 3600 as the duty; the duty field above is only shown.</p>
        </>
      )}
      {warnings.map((w) => <p key={w} className="admin__warn">{w}</p>)}
      {unmappedErrors.length > 0 && (
        <p role="alert" className="admin__error">{unmappedErrors.map(([k, msg]) => `${k || 'form'}: ${msg}`).join('; ')}</p>
      )}
      {saveError && <p role="alert" className="admin__error">{saveError}</p>}
      <div className="admin__actions">
        <button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
