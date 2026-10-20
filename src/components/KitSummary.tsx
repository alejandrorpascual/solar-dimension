import type { ReactNode } from 'react'
import { useLocale } from '../hooks/useLocale'
import { tr, type Dictionary } from '../i18n'
import { fmtHours, fmtInt, fmtKw, fmtKwh, fmtW } from '../i18n/format'
import { CHEMISTRIES } from '../lib/catalog'
import { finePrint } from '../lib/fine-print'
import { kitChecks, uncheckedWarnings, warningKey, warningText } from '../lib/kit-checks'
import { kitDeltas } from '../lib/kit-deltas'
import { buildParts, type Part } from '../lib/kit-parts'
import type { OversizeNote } from '../lib/oversize'
import { hasPanels, type SizingResult } from '../lib/sizing'
import { BatteryPicker } from './BatteryPicker'
import { ChecksList } from './ChecksList'
import { RuntimeRange } from './RuntimeRange'

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
            <th scope="row" role="rowheader" className="part__name">{pt.name}{pt.group === 'solar' && <span className="part__tag">{t.ui.solarTag}</span>}</th>
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
  /** The kit before the current quick edits; tiles show how far each figure moved from it. */
  baseline: SizingResult | null
  projectName: string
  /** Why the bank is far bigger than the load needs, when another voltage sizes a smaller one. */
  oversize: OversizeNote | null
  /** The edit bar (KitQuickEdit), placed under the summary line. */
  quickEdit: ReactNode
  onBatteryUnit: (id: string | null) => void
}

const signed = (n: number, fmt: (abs: number) => string) => (n === 0 ? '' : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`)

function Delta({ text }: { text: string }) {
  return text ? <span className="stat__delta num">{text}</span> : null
}

export function KitSummary({ result: r, baseline, projectName, oversize, quickEdit, onBatteryUnit }: Props) {
  const { t, locale } = useLocale()
  const parts = buildParts(r, t, locale)
  const checks = kitChecks(t, r, locale)
  const notes = uncheckedWarnings(r)
  const dod = Math.round(CHEMISTRIES[r.chemistry].dod * 100)
  const summary = r.empty ? t.ui.kitEmpty : tr(t, 'kitSummary', { count: r.count, hours: r.hours, volts: r.volts, chemistry: t.chemistries[r.chemistry] })
  const d = baseline ? kitDeltas(baseline, r) : null
  const w = (n: number) => fmtW(n, locale)
  return (
    <div className="kit">
      <div className="kit__head">
        <p className="muted">{summary}</p>
        {quickEdit}
      </div>
      <div className={`stats${hasPanels(r) ? ' stats--five' : ''}`}>
        <div className="stat">
          <div className="lab">{t.ui.runningLoad}</div>
          <div className="stat__row"><span className="stat__v num">{fmtW(r.runningW, locale)}</span><Delta text={d ? signed(d.runningW, w) : ''} /></div>
          {!r.empty && <div className="stat__sub num">{tr(t, 'averageDraw', { w: fmtW(r.averageW, locale) })}</div>}
        </div>
        <div className="stat">
          <div className="lab">{t.ui.startupPeak}</div>
          <div className="stat__row"><span className="stat__v num">{fmtW(r.surgeW, locale)}</span><Delta text={d ? signed(d.surgeW, w) : ''} /></div>
        </div>
        <div className="stat">
          <div className="lab">{t.ui.batteryNeeded}</div>
          <div className="stat__row"><span className="stat__v num">{fmtKwh(r.requiredWh, locale)}</span><Delta text={d ? signed(d.requiredWh, (n) => fmtKwh(n, locale)) : ''} /></div>
        </div>
        <div className="stat stat--accent">
          <div className="lab">{t.ui.runtime}</div>
          <div className="stat__row">
            <span className="stat__v num">{r.battery && !r.empty ? `~${fmtHours(r.battery.hoursActual, locale)}` : '—'}</span>
            <Delta text={d ? signed(d.runtimeH, (n) => fmtHours(n, locale)) : ''} />
          </div>
          {r.battery && !r.empty && <RuntimeRange runtime={r.battery.runtime} t={t} locale={locale} className="stat__sub num" />}
        </div>
        {hasPanels(r) && (
          <div className="stat stat--sun">
            <div className="lab">{t.ui.solarRecharge}</div>
            <div className="stat__row"><span className="stat__v num">{fmtKw(r.solar.arrayW, locale)}</span></div>
            <div className="stat__sub num">{tr(t, 'solarRechargeSub', { wh: fmtKwh(r.solar.dailyWh, locale) })}</div>
          </div>
        )}
      </div>
      {oversize && (
        <p className="note-box">
          {tr(t, oversize.isSmallestBank ? 'oversizeNoteSmallest' : 'oversizeNote', {
            ratio: fmtInt(oversize.ratio, locale), need: `${fmtInt(oversize.needWh, locale)} Wh`, inverter: fmtW(oversize.inverterW, locale),
            kitVolts: oversize.kitVolts, volts: oversize.volts, bank: fmtKwh(oversize.bankWh, locale),
          })}
        </p>
      )}
      {!r.empty && <BatteryPicker options={r.batteryOptions} selected={r.batteryUnit} onSelect={onBatteryUnit} />}
      <div className="parts">
        {parts.length > 0 ? <PartsTable parts={parts} t={t} /> : <p className="muted">{tr(t, 'nothingSelected', { name: projectName })}</p>}
      </div>
      {parts.length > 0 && <p className="estimate" role="note">{t.ui.estimateNotice}</p>}
      <ChecksList checks={checks} t={t} />
      {notes.length > 0 && (
        <div className="warn" role="status">
          {notes.map((n) => <div key={warningKey(n)}>{warningText(t, n, r.items)}</div>)}
        </div>
      )}
      <p className="fine muted">{finePrint(t, r, dod, locale)}</p>
    </div>
  )
}
