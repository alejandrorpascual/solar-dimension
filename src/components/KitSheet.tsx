import type { Ref } from 'react'
import { panelCount, tr, type Dictionary, type Locale } from '../i18n'
import { fmtHours, fmtKwh, fmtW } from '../i18n/format'
import { CHEMISTRIES } from '../lib/catalog'
import { finePrint } from '../lib/fine-print'
import { isFailing, kitChecks, kitNotes } from '../lib/kit-checks'
import type { Part } from '../lib/kit-parts'
import { requesterLines, type Requester } from '../lib/requester'
import { hasPanels, type SizingResult } from '../lib/sizing'
import { RuntimeRange } from './RuntimeRange'
import { SheetChecks } from './SheetChecks'
import { SheetSchedule } from './SheetSchedule'

/** The sheet's width in CSS pixels: A4 at 96 dpi. The PDF, the PNG and every preview are cut from this layout. */
export const SHEET_WIDTH = 794

export interface ExportInclude { summary: boolean; appliances: boolean; parts: boolean; checks: boolean; notes: boolean; requester: boolean }

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
 *
 * Two things are on the sheet whatever is ticked, because the person pricing the kit may see nothing else: the notes
 * no check owns, and every check that fails. They print last, so page one keeps its layout, and the header says in
 * one line, beside the subtitle, when either exists. The sentence that says this is an estimate is fixed too: it
 * sits under the parts it qualifies, above the assumptions, and no Include box removes it.
 */
export function KitSheet({ projectName, result: r, parts, requester, include, date, t, locale, ref }: Props) {
  const dod = Math.round(CHEMISTRIES[r.chemistry].dod * 100)
  const showParts = include.parts && parts.length > 0
  const showAppliances = include.appliances && r.items.length > 0
  const allChecks = kitChecks(t, r, locale)
  const failing = allChecks.filter(isFailing)
  const checks = include.checks ? allChecks : failing
  const notes = kitNotes(t, r)
  const attention = [
    failing.length > 0 ? tr(t, 'sheetAttentionChecks', { count: failing.length }) : '',
    notes.length > 0 ? tr(t, 'sheetAttentionNotes', { count: notes.length }) : '',
  ].filter(Boolean)
  /* The average draw the Wh over the window implies: the figure the app's summary shows under the running load. */
  const averageDraw = tr(t, 'averageDraw', { w: fmtW(r.averageW, locale) })
  return (
    <div ref={ref} className="ksheet">
      <header className="ksheet__head" data-pdf-block="">
        <div className="ksheet__kicker"><span>{t.ui.sheetTitle}</span><span>{date}</span></div>
        <h2 className="ksheet__title">{projectName}</h2>
        <div className="ksheet__subrow">
          <p className="ksheet__sub">{`${r.volts} V ${t.chemistries[r.chemistry]} · ${tr(t, 'hoursShort', { hours: r.hours })}${hasPanels(r) ? ` · ${panelCount(t, r.solar.panels)}` : ''}`}</p>
          {attention.length > 0 && <p className="ksheet__attn">{[t.ui.sheetAttention, ...attention].join(' · ')}</p>}
        </div>
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
          <div className="ksheet__fig--accent">
            <span className="ksheet__lab">{t.ui.runtime}</span><strong>{r.battery && !r.empty ? `~${fmtHours(r.battery.hoursActual, locale)}` : '—'}</strong>
            {r.battery && !r.empty && <RuntimeRange runtime={r.battery.runtime} t={t} locale={locale} className="ksheet__note" />}
          </div>
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

      <div className="ksheet__foot" data-pdf-block="">
        <p className="ksheet__estimate">{t.ui.estimateNotice}</p>
        {include.notes && <p className="ksheet__fine">{finePrint(t, r, dod, locale)}</p>}
      </div>

      {/* The load schedule supports the parts list: with one on the sheet it starts a page of its own. */}
      {showAppliances && <SheetSchedule result={r} t={t} locale={locale} breakBefore={showParts} />}

      {notes.length > 0 && (
        <section>
          <h3 className="ksheet__h" data-pdf-block="keep">{t.ui.sheetNotes}</h3>
          <div className="ksheet__notes">
            {notes.map((note) => <p key={note} data-pdf-block="">{note}</p>)}
          </div>
        </section>
      )}

      <SheetChecks checks={checks} t={t} />
    </div>
  )
}
