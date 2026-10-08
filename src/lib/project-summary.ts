import type { CatalogItem } from './catalog'
import type { Project } from './schema'
import { compute, type SelectedItem, type SizingResult } from './sizing'

const DEFAULT_TOP = 3

export interface ProjectSummary {
  project: Project
  result: SizingResult
  /** Running watts as a share of the heaviest project's, 0 to 1; 0 when every project is empty. */
  loadShare: number
  /** The appliances drawing the most running watts, heaviest first. */
  heaviest: SelectedItem[]
  /** How many selected appliances are not in `heaviest`. */
  moreCount: number
}

export function computeProject(p: Project, appliances: readonly CatalogItem[]): SizingResult {
  const e = p.electrical
  return compute(
    {
      qty: p.qty, custom: p.custom, hours: p.hours, volts: p.volts, chemistry: p.chemistry, batteryUnit: p.batteryUnit,
      dutyOverrides: p.dutyOverrides, simultaneousStarts: e.simultaneousStarts,
      cable: { runLengthM: e.runLengthM, ambientC: e.ambientC, bundled: e.bundled, insulationC: e.insulationC },
    },
    appliances,
  )
}

/** Every project with its sized kit, in store order, for side-by-side cards. */
export function summarizeProjects(projects: readonly Project[], appliances: readonly CatalogItem[], topN: number = DEFAULT_TOP): ProjectSummary[] {
  const results = projects.map((p) => computeProject(p, appliances))
  const maxW = Math.max(0, ...results.map((r) => r.runningW))
  return projects.map((project, i) => {
    const result = results[i]!
    const byWatts = [...result.items].sort((a, b) => b.totalWatts - a.totalWatts)
    const heaviest = byWatts.slice(0, topN)
    return {
      project, result, heaviest,
      loadShare: maxW > 0 ? result.runningW / maxW : 0,
      moreCount: byWatts.length - heaviest.length,
    }
  })
}
