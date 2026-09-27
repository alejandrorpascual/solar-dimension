import { useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { APPLIANCE_CATEGORIES, ApplianceSchema, applianceWarnings, slugify, type ApplianceRecord } from '../../lib/catalog-schema'
import { adminSaveAppliance } from '../../server/admin-catalog'

type Draft = Record<'nameEn' | 'noteEn' | 'nameEs' | 'noteEs' | 'category' | 'watts' | 'surge' | 'duty' | 'tons' | 'acType', string>

const toDraft = (r: ApplianceRecord | null): Draft => ({
  nameEn: r?.labels.en.name ?? '', noteEn: r?.labels.en.note ?? '', nameEs: r?.labels.es.name ?? '', noteEs: r?.labels.es.note ?? '',
  category: r?.category ?? 'Kitchen', watts: String(r?.watts ?? ''), surge: String(r?.surge ?? ''), duty: String(r?.duty ?? ''),
  tons: r?.tons != null ? String(r.tons) : '', acType: r?.acType ?? '',
})

function toInput(d: Draft, id: string) {
  const isAc = d.category === 'Air conditioning'
  return {
    id, category: d.category, watts: Number(d.watts), surge: Number(d.surge), duty: Number(d.duty),
    tons: isAc && d.tons ? Number(d.tons) : null, acType: isAc && d.acType ? d.acType : null,
    labels: { en: { name: d.nameEn, note: d.noteEn }, es: { name: d.nameEs, note: d.noteEs } },
  }
}

export function ApplianceForm({ initial, onSaved, onCancel }: { initial: ApplianceRecord | null; onSaved: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)
  const id = initial?.id ?? slugify(draft.nameEn)
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value })
  const parsed = ApplianceSchema.safeParse(toInput(draft, id))
  const warnings = parsed.success ? applianceWarnings(parsed.data) : []

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])))
      return
    }
    setSaving(true)
    try {
      await adminSaveAppliance({ data: parsed.data })
      onSaved()
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
      <p className="admin__id">id: <code>{id || '—'}</code>{!initial && ' (fixed after saving)'}</p>
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
      {warnings.map((w) => <p key={w} className="admin__warn">{w}</p>)}
      {saveError && <p role="alert" className="admin__error">{saveError}</p>}
      <div className="admin__actions">
        <button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
