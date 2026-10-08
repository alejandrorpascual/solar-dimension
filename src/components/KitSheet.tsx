import type { Ref } from 'react'
import { applianceName, tr, type Dictionary, type Locale } from '../i18n'
import { fmtHours, fmtInt, fmtKwh, fmtW } from '../i18n/format'
import { CHEMISTRIES } from '../lib/catalog'
import { requesterLines, type Requester } from '../lib/requester'
import type { SizingResult } from '../lib/sizing'
import type { Part } from './KitSummary'

/** The sheet's width in CSS pixels: A4 at 96 dpi. The PDF, the PNG and every preview are cut from this layout. */
export const SHEET_WIDTH = 794

export interface ExportInclude { summary: boolean; appliances: boolean; parts: boolean; notes: boolean; requester: boolean }

interface Props {
  projectName: string
  result: SizingResult
  parts: Part[]
  requester: Requester | null
  include: ExportInclude
  date: string
  t: Dictionary
  locale: Locale
  ref?: Ref<HTMLDivElement>
}

/**
 * The kit as a printable document, SHEET_WIDTH wide. The download panel shows it scaled down as a preview
 * and captures the same node for the PDF and the image, so the file matches what the preview showed.
 * `data-pdf-block` marks what a PDF page break must not cut; "keep" also holds it to the block after (headings), and
 * `data-pdf-break` starts a new page there.
 */
export function KitSheet({ projectName, result: r, parts, requester, include, date, t, locale, ref }: Props) {
  const dod = Math.round(CHEMISTRIES[r.chemistry].dod * 100)
  const totalWh = r.items.reduce((sum, i) => sum + i.wh, 0)
  const showParts = include.parts && parts.length > 0
  const showAppliances = include.appliances && r.items.length > 0
  /* The average draw the Wh over the window implies: the figure the app's summary shows under the running load. */
  const averageDraw = tr(t, 'averageDraw', { w: fmtW(r.averageW, locale) })
  return (
    <div ref={ref} className="ksheet">
      <header className="ksheet__head" data-pdf-block="">
        <div className="ksheet__kicker"><span>{t.ui.sheetTitle}</span><span>{date}</span></div>
        <h2 className="ksheet__title">{projectName}</h2>
        <p className="ksheet__sub">{`${r.volts} V ${t.chemistries[r.chemistry]} · ${tr(t, 'hoursShort', { hours: r.hours })}`}</p>
      </header>

      {requester && (
        <section className="ksheet__client" data-pdf-block="">
          <div className="ksheet__client-head">
            <h3 className="ksheet__h">{t.requester.bandTitle}</h3>
            <span className="ksheet__lab">{`${t.requester[requester.kind]} · ${t.requester[`country${requester.country}`]}`}</span>
          </div>
          <dl className="ksheet__client-grid">
            {requesterLines(requester).map((line) => (
              <div key={line.label} className={`ksheet__client-cell ksheet__client-cell--${line.width}`}>
                <dt className="ksheet__lab">{t.requester[line.label]}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {include.summary && (
        <div className="ksheet__figs" data-pdf-block="">
          <div>
            <span className="ksheet__lab">{t.ui.runningLoad}</span><strong>{fmtW(r.runningW, locale)}</strong>
            {!r.empty && <span className="ksheet__note">{averageDraw}</span>}
          </div>
          <div><span className="ksheet__lab">{t.ui.startupPeak}</span><strong>{fmtW(r.surgeW, locale)}</strong></div>
          <div><span className="ksheet__lab">{t.ui.batteryNeeded}</span><strong>{fmtKwh(r.requiredWh, locale)}</strong></div>
          <div className="ksheet__fig--accent"><span className="ksheet__lab">{t.ui.runtime}</span><strong>{r.battery && !r.empty ? `~${fmtHours(r.battery.hoursActual, locale)}` : '—'}</strong></div>
        </div>
      )}

      {showParts && (
        <section>
          <h3 className="ksheet__h" data-pdf-block="keep">{t.ui.incParts}</h3>
          <table className="ksheet__table ksheet__parts">
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} data-pdf-block="">
                  <th scope="row">{p.name}</th>
                  <td><div>{p.spec}</div><div className="ksheet__note">{p.note}</div></td>
                  <td className="ksheet__n ksheet__qty">{`×${p.qty}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {include.notes && <p className="ksheet__fine" data-pdf-block="">{tr(t, 'fine', { dod })}</p>}

      {showAppliances && (
        <section>
          {/* The load schedule supports the parts list: with one on the sheet it starts a page of its own. */}
          <h3 className="ksheet__h" data-pdf-block="keep" data-pdf-break={showParts ? '' : undefined}>{t.ui.loadSchedule}</h3>
          <table className="ksheet__table">
            <thead data-pdf-block="keep">
              <tr>
                <th>{t.ui.appliance}</th><th className="ksheet__n">{t.ui.quantity}</th><th className="ksheet__n">{t.ui.each}</th>
                <th className="ksheet__n">{t.ui.runningLoad}</th><th className="ksheet__n">{tr(t, 'overHours', { hours: r.hours })}</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.id} data-pdf-block="">
                  <td>{applianceName(t, i)}</td><td className="ksheet__n">{i.qty}</td><td className="ksheet__n">{fmtW(i.watts, locale)}</td>
                  <td className="ksheet__n">{fmtW(i.totalWatts, locale)}</td><td className="ksheet__n">{`${fmtInt(i.wh, locale)} Wh`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot data-pdf-block="">
              <tr>
                <td>{t.ui.total}</td><td className="ksheet__n">{r.count}</td><td />
                <td className="ksheet__n">{fmtW(r.runningW, locale)}<div className="ksheet__note">{averageDraw}</div></td>
                <td className="ksheet__n">{`${fmtInt(totalWh, locale)} Wh`}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </div>
  )
}
