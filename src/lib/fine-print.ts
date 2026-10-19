import { tr, type Dictionary, type Locale } from '../i18n'
import { fmtDecimal, fmtInt, fmtW } from '../i18n/format'
import { CHEMISTRIES } from './catalog'
import { hasPanels, type SizingResult } from './sizing'
import { SOLAR } from './solar'

/**
 * The battery and inverter ratings this kit was sized with. They are the generic ones in `catalog.ts`, not a maker's
 * datasheet, so the fine print says so. An inverter set is sized on each unit's surge, so one unit's is given.
 */
function ratingsLine(t: Dictionary, r: SizingResult, locale: Locale): string {
  const b = r.battery
  if (r.empty || !b) return ''
  const inv = r.inverter
  return tr(t, 'fineRatings', {
    battery: b.unitLabel, cont: fmtInt(b.unit.maxContinuousA, locale), peak: fmtInt(b.unit.peakA, locale), peakSeconds: b.unit.peakSeconds,
    parallel: b.unit.maxParallel, shortCircuit: CHEMISTRIES[r.chemistry].shortCircuitPerAh,
    inverter: fmtW(inv.unitW, locale), surge: fmtW(inv.surge / inv.count, locale), surgeSeconds: inv.surgeSeconds,
  })
}

/** The assumptions line under the kit and on the sheet, filled with the settings and ratings this kit was sized with; a panel kit adds the solar assumptions. */
export function finePrint(t: Dictionary, r: SizingResult, dodPct: number, locale: Locale): string {
  const starts = r.simultaneousStarts === 'all' ? t.ui.fineStartsAll : r.simultaneousStarts >= 2 ? t.ui.fineStartsTwo : t.ui.fineStartsOne
  const base = tr(t, 'fine', {
    dod: dodPct, starts, insulation: r.cable.insulationC, ambient: r.cable.ambientC, bundled: r.cable.bundled ? t.ui.fineBundled : '',
  }) + ratingsLine(t, r, locale)
  if (!hasPanels(r)) return base
  return base + tr(t, 'fineSolar', { w: `${SOLAR.PANEL_W} W`, sun: fmtDecimal(r.solar.sunHours, 1, locale) })
}
