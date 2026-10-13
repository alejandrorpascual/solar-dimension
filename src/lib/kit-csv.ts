import { applianceName, tr, type Dictionary } from '../i18n'
import { buildCsv } from './export-csv'
import { isFailing, kitChecks, kitNotes } from './kit-checks'
import type { Part } from './kit-parts'
import { averageWatts, groupByKind } from './load-kinds'
import type { SizingResult } from './sizing'

export interface CsvInclude { appliances: boolean; parts: boolean }

/**
 * The kit as a spreadsheet, in the user's language: the load schedule by kind, then the parts list, each when ticked.
 * The failing checks and the notes follow when the kit has any, whatever is ticked, and the line that says this is an
 * estimate always closes the file, since a supplier may get this file and nothing else.
 */
export function csvFor(result: SizingResult, parts: readonly Part[], include: CsvInclude, t: Dictionary): string {
  const failing = kitChecks(t, result, t.locale).filter(isFailing).flatMap((c) => c.lines.map((text) => ({ name: c.name, text })))
  const notes = kitNotes(t, result).map((text) => ({ name: t.ui.note, text }))
  return buildCsv({
    attention: [...failing, ...notes],
    footer: t.ui.estimateNotice,
    headers: {
      attention: [t.ui.checkWarn, t.ui.note],
      appliances: [t.ui.appliance, t.ui.kind, t.ui.quantity, t.ui.eachW, t.ui.runningWatts, t.ui.averageWatts, tr(t, 'whOver', { hours: result.hours })],
      parts: [t.ui.part, t.ui.specification, t.ui.note, t.ui.quantity],
    },
    appliances: groupByKind(result.items).flatMap((g) =>
      g.items.map((i) => ({ name: applianceName(t, i), kind: t.kinds[i.kind], qty: i.qty, eachW: i.watts, runningW: i.totalWatts, averageW: averageWatts(i), wh: i.wh })),
    ),
    parts: parts.map((p) => ({ name: p.name, spec: p.spec, note: p.note, qty: p.qty })),
    include,
  })
}
