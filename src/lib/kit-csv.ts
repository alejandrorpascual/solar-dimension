import { applianceName, tr, type Dictionary } from '../i18n'
import { buildCsv } from './export-csv'
import type { Part } from './kit-parts'
import { averageWatts, groupByKind } from './load-kinds'
import type { SizingResult } from './sizing'

export interface CsvInclude { appliances: boolean; parts: boolean }

/** The kit as a spreadsheet: the load schedule by kind, then the parts list, in the user's language. */
export function csvFor(result: SizingResult, parts: readonly Part[], include: CsvInclude, t: Dictionary): string {
  return buildCsv({
    headers: {
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
