import type { Project } from './schema'

export function diffProjects(prev: readonly Project[], next: readonly Project[]): { upserts: Project[]; deletes: string[] } {
  const before = new Map(prev.map((p) => [p.id, JSON.stringify(p)]))
  const after = new Set(next.map((p) => p.id))
  const upserts = next.filter((p) => before.get(p.id) !== JSON.stringify(p))
  const deletes = prev.filter((p) => !after.has(p.id)).map((p) => p.id)
  return { upserts, deletes }
}

/** Overlay a set of local changes on a list from the server: upserts replace or append by id, deletes drop. */
export function applyChanges(base: readonly Project[], changes: { upserts: readonly Project[]; deletes: readonly string[] }): Project[] {
  const gone = new Set(changes.deletes)
  const replaced = new Map(changes.upserts.map((p) => [p.id, p]))
  const kept = base.filter((p) => !gone.has(p.id)).map((p) => replaced.get(p.id) ?? p)
  const present = new Set(kept.map((p) => p.id))
  const added = changes.upserts.filter((p) => !present.has(p.id) && !gone.has(p.id))
  return [...kept, ...added]
}
