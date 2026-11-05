import type { ReactNode } from 'react'
import { useLocale } from '../hooks/useLocale'
import { applianceCount, tr, type Dictionary } from '../i18n'
import { fmtHours, fmtInt, fmtKw, fmtKwh, fmtW } from '../i18n/format'
import { CHEMISTRIES } from '../lib/catalog'
import { finePrint } from '../lib/fine-print'
import { attentionLine, kitChecks, uncheckedWarnings, warningKey, warningText } from '../lib/kit-checks'
import { kitDeltas } from '../lib/kit-deltas'
import { buildParts, type Part } from '../lib/kit-parts'
import type { OversizeNote } from '../lib/oversize'
import { hasPanels, type SizingResult } from '../lib/sizing'
import { BatteryPicker } from './BatteryPicker'
import { ChecksAttention } from './ChecksAttention'
import { ChecksList } from './ChecksList'
import { Fold } from './Fold'
import { Glossary } from './Glossary'
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
  /** The edit bar (KitQuickEditBar), placed under the summary line. */
  quickEdit: ReactNode
  /** The appliance list the bar opens, under the figures it changes. */
  quickEditPanel?: ReactNode
  onBatteryUnit: (id: string | null) => void
}

const signed = (n: number, fmt: (abs: number) => string) => (n === 0 ? '' : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`)

/** How far a figure moved since the quick edit began; a screen reader hears what the bare "+1.2 h" is. */
function Delta({ text, t }: { text: string; t: Dictionary }) {
  if (!text) return null
  return (
    <>
      <span className="stat__delta num">{text}</span>
      <span className="visually-hidden"> {t.ui.deltaSuffix}</span>
    </>
  )
}

/** One figure of the kit: its name, the value (and how far it moved) and an optional line under it. */
function Stat({ label, value, delta, className, children }: { label: string; value: string; delta?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={className ? `stat ${className}` : 'stat'}>
      <dt className="lab">{label}</dt>
      <dd className="stat__row"><span className="stat__v num">{value}</span>{delta}</dd>
      {children}
    </div>
  )
}

export function KitSummary({ result: r, baseline, projectName, oversize, quickEdit, quickEditPanel, onBatteryUnit }: Props) {
  const { t, locale } = useLocale()
  const parts = buildParts(r, t, locale)
  const checks = kitChecks(t, r, locale)
  const notes = uncheckedWarnings(r)
  const dod = Math.round(CHEMISTRIES[r.chemistry].dod * 100)
  const summary = tr(t, 'kitSummary', { appliances: applianceCount(t, r.items.length, r.units), hours: r.hours, volts: r.volts, chemistry: t.chemistries[r.chemistry] })
  const d = baseline ? kitDeltas(baseline, r) : null
  const w = (n: number) => fmtW(n, locale)
  // Why Runtime reads past the hours asked for, unless the oversize note below already says why the bank is big.
  const runsLonger = !oversize && r.battery !== null && Math.round(r.battery.hoursActual) > r.hours
  const longer = runsLonger && !r.empty ? tr(t, 'runtimeLonger', { hours: r.hours }) : ''
  return (
    <div className="kit">
      <div className="kit__head">
        {/* Said in the intro on wide screens and under the figure on a phone (components.css), so the figure starts near the top there. */}
        {!r.empty && <p className="muted">{summary}{longer && <span className="kit__why">{` ${longer}`}</span>}</p>}
        <ChecksAttention text={attentionLine(t, r)} />
        {quickEdit}
      </div>
      {/* Runtime leads: it is the answer the visitor came for, so it comes first and one step larger than the rest. */}
      {!r.empty && <h2 className="visually-hidden">{t.ui.incSummary}</h2>}
      {!r.empty && <dl className={`stats${hasPanels(r) ? ' stats--five' : ''}`}>
        <Stat className="stat--accent stat--lead" label={t.ui.runtime} value={r.battery ? `~${fmtHours(r.battery.hoursActual, locale)}` : '—'}
          delta={<Delta t={t} text={d ? signed(d.runtimeH, (n) => fmtHours(n, locale)) : ''} />}>
          {r.battery && r.battery.runtime.typical > 0 && <dd className="stat__sub num"><RuntimeRange runtime={r.battery.runtime} t={t} locale={locale} /></dd>}
          {longer && <dd className="stat__sub stat__why">{longer}</dd>}
        </Stat>
        <Stat label={t.ui.runningLoad} value={fmtW(r.runningW, locale)} delta={<Delta t={t} text={d ? signed(d.runningW, w) : ''} />}>
          <dd className="stat__sub num">{tr(t, 'averageDraw', { w: fmtW(r.averageW, locale) })}</dd>
        </Stat>
        <Stat label={t.ui.startupPeak} value={fmtW(r.surgeW, locale)} delta={<Delta t={t} text={d ? signed(d.surgeW, w) : ''} />} />
        <Stat label={t.ui.batteryNeeded} value={fmtKwh(r.requiredWh, locale)} delta={<Delta t={t} text={d ? signed(d.requiredWh, (n) => fmtKwh(n, locale)) : ''} />} />
        {hasPanels(r) && (
          <Stat className="stat--sun" label={t.ui.solarRecharge} value={fmtKw(r.solar.arrayW, locale)}>
            <dd className="stat__sub num">{tr(t, 'solarRechargeSub', { wh: fmtKwh(r.solar.dailyWh, locale) })}</dd>
          </Stat>
        )}
      </dl>}
      {oversize && (
        <p className="note-box">
          {tr(t, oversize.isSmallestBank ? 'oversizeNoteSmallest' : 'oversizeNote', {
            ratio: fmtInt(oversize.ratio, locale), need: `${fmtInt(oversize.needWh, locale)} Wh`, inverter: fmtW(oversize.inverterW, locale),
            kitVolts: oversize.kitVolts, volts: oversize.volts, bank: fmtKwh(oversize.bankWh, locale),
          })}
        </p>
      )}
      {!r.empty && <BatteryPicker options={r.batteryOptions} selected={r.batteryUnit} onSelect={onBatteryUnit} />}
      {quickEditPanel}
      <div className="parts">
        {parts.length > 0 && <h2 className="visually-hidden">{t.ui.incParts}</h2>}
        {parts.length > 0 ? <PartsTable parts={parts} t={t} /> : <p className="muted">{tr(t, 'nothingSelected', { name: projectName })}</p>}
      </div>
      {parts.length > 0 && <p className="estimate" role="note">{hasPanels(r) ? `${t.ui.estimateNotice} ${t.ui.solarNotSized}` : t.ui.estimateNotice}</p>}
      <ChecksList checks={checks} t={t} />
      {notes.length > 0 && (
        <div className="warn" role="status">
          {notes.map((n) => <div key={warningKey(n)}>{warningText(t, n, r)}</div>)}
        </div>
      )}
      <Fold title={t.ui.incNotes}>
        <p className="fine muted">{finePrint(t, r, dod, locale)}</p>
      </Fold>
      <Glossary />
    </div>
  )
}
