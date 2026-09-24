import { useState } from 'react'
import { EMPTY_FORM, parseCustom, type CustomForm } from '../lib/custom'
import type { Store } from '../lib/schema'
import { addCustom, currentProject } from '../lib/store'

export function CustomApplianceForm({ store, commit }: { store: Store; commit: (s: Store) => void }) {
  const [form, setForm] = useState<CustomForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const set = (patch: Partial<CustomForm>) => { setForm({ ...form, ...patch }); setError('') }

  function submit() {
    const res = parseCustom(form, currentProject(store).custom.map((c) => c.id))
    if (!res.ok) { setError(res.error); return }
    commit(addCustom(store, res.item))
    setForm(EMPTY_FORM)
  }

  const isVa = form.mode === 'va'
  return (
    <div className="custom">
      <div className="custom__head">
        <div>
          <div className="custom__title">Something not on the list?</div>
          <div className="muted custom__hint">Type the watts from the label, or the volts and amps and we multiply them.</div>
        </div>
        <div className="custom__modes">
          <button type="button" className={`seg${!isVa ? ' seg--on' : ''}`} onClick={() => set({ mode: 'watts' })}>Watts</button>
          <button type="button" className={`seg${isVa ? ' seg--on' : ''}`} onClick={() => set({ mode: 'va' })}>Volts × amps</button>
        </div>
      </div>
      <div className="custom__row">
        <label className="field field--grow"><span className="lab">Name</span><input className="in" type="text" placeholder="Pool pump" value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
        {isVa ? (
          <>
            <label className="field"><span className="lab">Volts</span><input className="in" type="number" min="0" placeholder="230" value={form.volts} onChange={(e) => set({ volts: e.target.value })} /></label>
            <label className="field"><span className="lab">Amps</span><input className="in" type="number" min="0" step="0.1" placeholder="3.5" value={form.amps} onChange={(e) => set({ amps: e.target.value })} /></label>
          </>
        ) : (
          <label className="field"><span className="lab">Running W</span><input className="in" type="number" min="0" placeholder="750" value={form.watts} onChange={(e) => set({ watts: e.target.value })} /></label>
        )}
        <label className="field"><span className="lab">Surge W (optional)</span><input className="in" type="number" min="0" placeholder="same as running" value={form.surge} onChange={(e) => set({ surge: e.target.value })} /></label>
        <button type="button" className="btn btn--primary custom__submit" onClick={submit}>Add appliance</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  )
}
