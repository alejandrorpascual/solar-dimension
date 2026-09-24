import type { Project } from './schema'

export function diffProjects(prev: readonly Project[], next: readonly Project[]): { upserts: Project[]; deletes: string[] } {
  const before = new Map(prev.map((p) => [p.id, JSON.stringify(p)]))
  const after = new Set(next.map((p) => p.id))
  const upserts = next.filter((p) => before.get(p.id) !== JSON.stringify(p))
  const deletes = prev.filter((p) => !after.has(p.id)).map((p) => p.id)
  return { upserts, deletes }
}
