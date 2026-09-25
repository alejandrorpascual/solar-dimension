import { useLocale } from '../hooks/useLocale'
import { BatteryPicker } from './BatteryPicker'
import { applianceName, tr, type Dictionary, type Locale } from '../i18n'
import { fmtHours, fmtInt, fmtKwh, fmtW } from '../i18n/format'
import { CHEMISTRIES } from '../lib/catalog'
import type { SizingResult, Warning } from '../lib/sizing'

export interface Part { id: string; name: string; spec: string; note: string; qty: string }

export function buildParts(r: SizingResult, t: Dictionary, locale: Locale): Part[] {
  const b = r.battery
  if (r.empty || !b) return []
  const c = r.cable
  const cm = Math.round(c.linkLengthM * 100)
  const perRun = c.runs > 1 ? t.ui.perRun : ''
  const w = (n: number) => fmtW(n, locale)
  return [
    { id: 'inverter', name: t.parts.inverter, spec: tr(t, 'inverterSpec', { w: w(r.inverter.w), volts: r.volts }), note: tr(t, 'inverterNote', { surge: w(r.inverter.surge), running: w(r.runningW), peak: w(r.surgeW) }), qty: '1' },
    { id: 'batteries', name: t.parts.batteries, spec: b.unitLabel, note: tr(t, 'batteriesNote', { series: b.series, parallel: b.parallel, config: b.config, bank: fmtKwh(b.bankWh, locale), usable: fmtKwh(b.usableWh, locale) }), qty: String(b.count) },
    { id: 'mainCable', name: t.parts.mainCable, spec: tr(t, 'mainCableSpec', { gauge: c.gauge, mm2: c.mm2, length: c.mainLengthM }), note: tr(t, 'mainCableNote', { amps: fmtInt(c.amps, locale), drop: c.dropPct }), qty: String(c.mainCount) },
    { id: 'interconnects', name: t.parts.interconnects, spec: tr(t, 'interconnectsSpec', { gauge: c.gauge, cm }), note: tr(t, 'interconnectsNote', { series: c.seriesLinks, parallel: c.parallelLinks }), qty: String(c.seriesLinks + c.parallelLinks) },
    { id: 'fuse', name: t.parts.fuse, spec: tr(t, 'fuseSpec', { amps: c.fuseA, perRun }), note: t.ui.fuseNote, qty: String(c.runs) },
  ]
}

function warningText(t: Dictionary, w: Warning): string {
  const itemName = w.params.itemId ? applianceName(t, { id: w.params.itemId, name: w.params.itemName ?? '' }) : w.params.itemName
  return t.warnings[w.code]({ ...w.params, itemName })
}

/**
 * A real table so every spec shares one column; components.css restacks the rows on phones. The explicit roles look
 * redundant but are not: Safari drops table semantics once CSS changes a table's `display`, as the phone layout does.
 */
function PartsTable({ parts, t }: { parts: Part[]; t: Dictionary }) {
  return (
    <table className="parts__table" role="table">
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader" className="lab parts__col-part">{t.ui.part}</th>
          <th scope="col" role="columnheader" className="lab">{t.ui.specification}</th>
          <th scope="col" role="columnheader" className="lab parts__col-qty">{t.ui.quantity}</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {parts.map((pt) => (
          <tr key={pt.id} className="part" role="row">
            <th scope="row" role="rowheader" className="part__name">{pt.name}</th>
            <td role="cell" className="part__body">
              <div className="part__spec">{pt.spec}</div>
              <div className="part__note">{pt.note}</div>
            </td>
            <td role="cell" className="part__qty num"><span aria-hidden="true">×</span>{pt.qty}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface Props {
  result: SizingResult
  projectName: string
  onEditAppliances: () => void
  onEditWindow: () => void
  onBatteryUnit: (id: string | null) => void
}

export function KitSummary({ result: r, projectName, onEditAppliances, onEditWindow, onBatteryUnit }: Props) {
  const { t, locale } = useLocale()
  const parts = buildParts(r, t, locale)
  const dod = Math.round(CHEMISTRIES[r.chemistry].dod * 100)
  const summary = r.empty ? t.ui.kitEmpty : tr(t, 'kitSummary', { count: r.count, hours: r.hours, volts: r.volts, chemistry: t.chemistries[r.chemistry] })
  return (
    <div className="kit">
      <div className="kit__head">
        <p className="muted">{summary}</p>
        <div className="kit__edit">
          <button type="button" className="chip" onClick={onEditAppliances}>{t.ui.editAppliances}</button>
          <button type="button" className="chip" onClick={onEditWindow}>{t.ui.editWindow}</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat">
          <div className="lab">{t.ui.runningLoad}</div>
          <div className="stat__v num">{fmtW(r.runningW, locale)}</div>
          {!r.empty && <div className="stat__sub num">{tr(t, 'averageDraw', { w: fmtW(r.averageW, locale) })}</div>}
        </div>
        <div className="stat"><div className="lab">{t.ui.startupPeak}</div><div className="stat__v num">{fmtW(r.surgeW, locale)}</div></div>
        <div className="stat"><div className="lab">{t.ui.batteryNeeded}</div><div className="stat__v num">{fmtKwh(r.requiredWh, locale)}</div></div>
        <div className="stat stat--accent"><div className="lab">{t.ui.runtime}</div><div className="stat__v num">{r.battery && !r.empty ? `~${fmtHours(r.battery.hoursActual, locale)}` : '—'}</div></div>
      </div>
      {!r.empty && <BatteryPicker options={r.batteryOptions} selected={r.batteryUnit} onSelect={onBatteryUnit} />}
      <div className="parts">
        {parts.length > 0 ? <PartsTable parts={parts} t={t} /> : <p className="muted">{tr(t, 'nothingSelected', { name: projectName })}</p>}
      </div>
      {r.warnings.length > 0 && (
        <div className="warn" role="status">
          {r.warnings.map((w) => <div key={w.code}>{warningText(t, w)}</div>)}
        </div>
      )}
      <p className="fine muted">{tr(t, 'fine', { dod })}</p>
    </div>
  )
}
