import { tr, type Dictionary } from '../i18n'
import type { SizingResult } from './sizing'

/** The assumptions line under the kit and on the sheet, filled with the settings this kit was sized with. */
export function finePrint(t: Dictionary, r: SizingResult, dodPct: number): string {
  const starts = r.simultaneousStarts === 'all' ? t.ui.fineStartsAll : r.simultaneousStarts >= 2 ? t.ui.fineStartsTwo : t.ui.fineStartsOne
  return tr(t, 'fine', {
    dod: dodPct, starts, insulation: r.cable.insulationC, ambient: r.cable.ambientC, bundled: r.cable.bundled ? t.ui.fineBundled : '',
  })
}
