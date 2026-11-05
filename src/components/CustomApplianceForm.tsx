import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { fmtInt } from '../i18n/format'
import { MAX_APPLIANCE_SURGE, MAX_APPLIANCE_WATTS } from '../lib/catalog'
import { CUSTOM_DUTY_MIN_PCT, CUSTOM_NAME_MAX, EMPTY_FORM, parseCustom, type CustomError, type CustomForm } from '../lib/custom'
import type { Store } from '../lib/schema'
import { addCustom, currentProject, removeUnreadCustom, takenLoadIds, unreadCustomCount } from '../lib/store'

export function CustomApplianceForm({ store, commit, onAdded }: { store: Store; commit: (s: Store) => void; onAdded: (name: string) => void }) {
  const { t, locale } = useLocale()
  const [form, setForm] = useState<CustomForm>(EMPTY_FORM)
  const [error, setError] = useState<CustomError | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  // Counts adds, so the focus below runs once each add has rendered.
  const [added, setAdded] = useState(0)
  // The form empties for the next one. Focus waits for the render: the first custom appliance adds a section to the list
  // above, which pushes the form down, under the footer. scrollIntoView keeps clear of it through the page's scroll-padding.
  useEffect(() => {
    if (added === 0) return
    const name = nameRef.current
    name?.focus({ preventScroll: true })
    name?.scrollIntoView({ block: 'nearest' })
  }, [added])
  const set = (patch: Partial<CustomForm>) => { setForm({ ...form, ...patch }); setError(null) }

  const project = currentProject(store)
  const unread = unreadCustomCount(project)

  function submit() {
    const res = parseCustom(form, takenLoadIds(project))
    if (!res.ok) { setError(res.error); return }
    commit(addCustom(store, res.item))
    setForm(EMPTY_FORM)
    setAdded(added + 1)
    onAdded(res.item.name)
  }

  const isVa = form.mode === 'va'
  return (
    <div className={`custom${isVa ? ' custom--va' : ''}`}>
      <div className="custom__head">
        <div>
          <div className="custom__title">{t.ui.customTitle}</div>
          <div className="muted custom__hint">{t.ui.customHelp}</div>
        </div>
        <div className="custom__modes" role="group" aria-label={t.ui.powerEntry}>
          <button type="button" className={`seg${!isVa ? ' seg--on' : ''}`} aria-pressed={!isVa} onClick={() => set({ mode: 'watts' })}>{t.ui.watts}</button>
          <button type="button" className={`seg${isVa ? ' seg--on' : ''}`} aria-pressed={isVa} onClick={() => set({ mode: 'va' })}>{t.ui.voltsAmps}</button>
        </div>
      </div>
      {unread > 0 && (
        <div className="warn custom__unread" role="status">
          <span>{tr(t, unread === 1 ? 'customUnreadOne' : 'customUnreadMany', { count: unread })}</span>
          <button type="button" className="custom__unread-clear" onClick={() => commit(removeUnreadCustom(store))}>
            {unread === 1 ? t.ui.customUnreadClearOne : t.ui.customUnreadClearMany}
          </button>
        </div>
      )}
      <div className="custom__row">
        <label className="field field--grow"><span className="lab">{t.ui.name}</span><input ref={nameRef} className="in" type="text" maxLength={CUSTOM_NAME_MAX} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
        {isVa ? (
          <>
            <label className="field"><span className="lab">{t.ui.volts}</span><input className="in" type="number" min="0" placeholder="230" value={form.volts} onChange={(e) => set({ volts: e.target.value })} /></label>
            <label className="field"><span className="lab">{t.ui.amps}</span><input className="in" type="number" min="0" step="0.1" placeholder="3.5" value={form.amps} onChange={(e) => set({ amps: e.target.value })} /></label>
          </>
        ) : (
          <label className="field"><span className="lab">{t.ui.runningW}</span><input className="in" type="number" min="0" placeholder="750" value={form.watts} onChange={(e) => set({ watts: e.target.value })} /></label>
        )}
        <label className="field field--surge"><span className="lab">{t.ui.surgeOptional}</span><input className="in" type="number" min="0" placeholder={t.ui.sameAsRunning} value={form.surge} onChange={(e) => set({ surge: e.target.value })} /></label>
        <label className="field"><span className="lab">{t.ui.dutyPctLabel}</span><input className="in" type="number" min={CUSTOM_DUTY_MIN_PCT} max="100" placeholder="100" value={form.dutyPct} onChange={(e) => set({ dutyPct: e.target.value })} /></label>
        <button type="button" className="btn btn--primary custom__submit" onClick={submit}>{t.ui.addAppliance}</button>
      </div>
      {error && <div className="error" role="alert">{tr(t, error, { max: CUSTOM_NAME_MAX, min: CUSTOM_DUTY_MIN_PCT, maxW: fmtInt(MAX_APPLIANCE_WATTS, locale), maxSurge: fmtInt(MAX_APPLIANCE_SURGE, locale) })}</div>}
    </div>
  )
}
