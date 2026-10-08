import { applianceName, tr, type Dictionary, type Locale } from '../i18n'
import { fmtInt, fmtW } from '../i18n/format'
import { averageWatts, groupByKind } from '../lib/load-kinds'
import type { SizingResult } from '../lib/sizing'

interface Props {
  result: SizingResult
  t: Dictionary
  locale: Locale
  /** Start a new PDF page here (when the parts list is on the sheet, the schedule gets a page of its own). */
  breakBefore: boolean
}

const COLUMNS = 6

/** The load schedule on the sheet: every selected appliance grouped by how it draws, with its average and its energy. */
export function SheetSchedule({ result: r, t, locale, breakBefore }: Props) {
  const totalWh = r.items.reduce((sum, i) => sum + i.wh, 0)
  return (
    <section>
      <h3 className="ksheet__h" data-pdf-block="keep" data-pdf-break={breakBefore ? '' : undefined}>{t.ui.loadSchedule}</h3>
      <table className="ksheet__table">
        <thead data-pdf-block="keep">
          <tr>
            <th>{t.ui.appliance}</th><th className="ksheet__n">{t.ui.quantity}</th><th className="ksheet__n">{t.ui.each}</th>
            <th className="ksheet__n">{t.ui.runningLoad}</th><th className="ksheet__n">{t.ui.average}</th><th className="ksheet__n">{tr(t, 'overHours', { hours: r.hours })}</th>
          </tr>
        </thead>
        {groupByKind(r.items).map((g) => (
          <tbody key={g.kind}>
            <tr className="ksheet__group" data-pdf-block="keep"><th colSpan={COLUMNS} scope="rowgroup">{t.kinds[g.kind]}</th></tr>
            {g.items.map((i) => (
              <tr key={i.id} data-pdf-block="">
                <td>{applianceName(t, i)}</td><td className="ksheet__n">{i.qty}</td><td className="ksheet__n">{fmtW(i.watts, locale)}</td>
                <td className="ksheet__n">{fmtW(i.totalWatts, locale)}</td><td className="ksheet__n">{fmtW(averageWatts(i), locale)}</td>
                <td className="ksheet__n">{`${fmtInt(i.wh, locale)} Wh`}</td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot data-pdf-block="">
          <tr>
            <td>{t.ui.total}</td><td className="ksheet__n">{r.count}</td><td />
            <td className="ksheet__n">{fmtW(r.runningW, locale)}</td><td className="ksheet__n">{fmtW(r.averageW, locale)}</td>
            <td className="ksheet__n">{`${fmtInt(totalWh, locale)} Wh`}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}
