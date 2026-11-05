import { applianceName, tr, type Dictionary } from '../i18n'
import type { ProjectSummary } from '../lib/project-summary'

/** "Refrigerator, 2× TV and 3 more" from the heaviest appliances. */
export function heaviestLine(s: ProjectSummary, t: Dictionary): string {
  const list = s.heaviest.map((i) => (i.qty > 1 ? `${i.qty}× ` : '') + applianceName(t, i)).join(', ')
  return s.moreCount > 0 ? tr(t, 'heaviestMore', { list, count: s.moreCount }) : list
}
