import type { Ref } from 'react'
import { applianceName, tr, type Dictionary, type Locale } from '../i18n'
import { fmtHours, fmtInt, fmtKwh, fmtW } from '../i18n/format'
import { CHEMISTRIES } from '../lib/catalog'
import type { SizingResult } from '../lib/sizing'
import type { Part } from './KitSummary'

export interface ExportInclude { summary: boolean; appliances: boolean; parts: boolean; notes: boolean }

interface Props {
  projectName: string
  result: SizingResult
  parts: Part[]
  include: ExportInclude
  date: string
  t: Dictionary
  locale: Locale
  ref?: Ref<HTMLDivElement>
}

/**
 * The kit as a one-page document, 794 px wide (A4 at 96 dpi). The download panel shows it scaled down as a preview
 * and captures the same node for the PDF and the image, so the file matches what the preview showed.
 */
export function KitSheet({ projectName, result: r, parts, include, date, t, locale, ref }: Props) {
  const dod = Math.round(CHEMISTRIES[r.chemistry].dod * 100)
  const totalWh = r.items.reduce((sum, i) => sum + i.wh, 0)
  return (
    <div ref={ref} className="ksheet">
      <header className="ksheet__head">
        <div className="ksheet__kicker"><span>{t.ui.sheetTitle}</span><span>{date}</span></div>
        <h2 className="ksheet__title">{projectName}</h2>
        <p className="ksheet__sub">{`${r.volts} V ${t.chemistries[r.chemistry]} · ${tr(t, 'hoursShort', { hours: r.hours })}`}</p>
      </header>

      {include.summary && (
        <div className="ksheet__figs">
          <div><span className="ksheet__lab">{t.ui.runningLoad}</span><strong>{fmtW(r.runningW, locale)}</strong></div>
          <div><span className="ksheet__lab">{t.ui.startupPeak}</span><strong>{fmtW(r.surgeW, locale)}</strong></div>
          <div><span className="ksheet__lab">{t.ui.batteryNeeded}</span><strong>{fmtKwh(r.requiredWh, locale)}</strong></div>
          <div className="ksheet__fig--accent"><span className="ksheet__lab">{t.ui.runtime}</span><strong>{r.battery && !r.empty ? `~${fmtHours(r.battery.hoursActual, locale)}` : '—'}</strong></div>
        </div>
      )}

      {include.appliances && r.items.length > 0 && (
        <section>
          <h3 className="ksheet__h">{t.ui.loadSchedule}</h3>
          <table className="ksheet__table">
            <thead>
              <tr>
                <th>{t.ui.appliance}</th><th className="ksheet__n">{t.ui.quantity}</th><th className="ksheet__n">{t.ui.each}</th>
                <th className="ksheet__n">{t.ui.runningLoad}</th><th className="ksheet__n">{tr(t, 'overHours', { hours: r.hours })}</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.id}>
                  <td>{applianceName(t, i)}</td><td className="ksheet__n">{i.qty}</td><td className="ksheet__n">{fmtW(i.watts, locale)}</td>
                  <td className="ksheet__n">{fmtW(i.totalWatts, locale)}</td><td className="ksheet__n">{`${fmtInt(i.wh, locale)} Wh`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t.ui.total}</td><td className="ksheet__n">{r.count}</td><td />
                <td className="ksheet__n">{fmtW(r.runningW, locale)}</td><td className="ksheet__n">{`${fmtInt(totalWh, locale)} Wh`}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {include.parts && parts.length > 0 && (
        <section>
          <h3 className="ksheet__h">{t.ui.incParts}</h3>
          <table className="ksheet__table ksheet__parts">
            <tbody>
              {parts.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td><div>{p.spec}</div><div className="ksheet__note">{p.note}</div></td>
                  <td className="ksheet__n ksheet__qty">{`×${p.qty}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {include.notes && <p className="ksheet__fine">{tr(t, 'fine', { dod })}</p>}
    </div>
  )
}
