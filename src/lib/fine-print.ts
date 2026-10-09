import { tr, type Dictionary, type Locale } from '../i18n'
import { fmtDecimal } from '../i18n/format'
import { hasPanels, type SizingResult } from './sizing'
import { SOLAR } from './solar'

/** The assumptions line under the kit and on the sheet, filled with the settings this kit was sized with; a panel kit adds the solar assumptions. */
export function finePrint(t: Dictionary, r: SizingResult, dodPct: number, locale: Locale): string {
  const starts = r.simultaneousStarts === 'all' ? t.ui.fineStartsAll : r.simultaneousStarts >= 2 ? t.ui.fineStartsTwo : t.ui.fineStartsOne
  const base = tr(t, 'fine', {
    dod: dodPct, starts, insulation: r.cable.insulationC, ambient: r.cable.ambientC, bundled: r.cable.bundled ? t.ui.fineBundled : '',
  })
  if (!hasPanels(r)) return base
  return base + tr(t, 'fineSolar', { w: `${SOLAR.PANEL_W} W`, sun: fmtDecimal(r.solar.sunHours, 1, locale) })
}
