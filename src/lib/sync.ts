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

/** How far ahead of the server a device's clock may run and still be believed: the margin Kerberos allows between clocks. */
export const MAX_CLOCK_LEAD_MS = 5 * 60_000

/**
 * The stamp the account stores for a save. A stamp further ahead of the server's clock than MAX_CLOCK_LEAD_MS comes
 * from a wrong clock and is replaced by the server's time: left as it was, the account would refuse every later edit
 * as older, from that device once its clock is right and from any other. A stamp within the margin is kept as the
 * device wrote it, so two saves from one device keep their order whichever arrives first.
 *
 * The limit of this: saves stamped by a clock that far ahead are ordered by arrival, so an older one that a reload cut
 * off and that arrives after a newer one replaces it. Stamping edits in the server's time would remove that; the
 * device's clock is all an edit made without a connection has.
 */
export function clampStamp(stamp: number, now: number): number {
  return stamp > now + MAX_CLOCK_LEAD_MS ? now : stamp
}

/**
 * After a save the account refused for some projects because it holds a newer copy (`stale`): those copies replace
 * the local ones, except where the project was edited again since it was sent (`sent`); that edit is on its way in a
 * later save and stays on screen until the account answers it.
 */
export function adoptStale(projects: readonly Project[], sent: readonly Project[], stale: readonly Project[]): Project[] {
  const sentById = new Map(sent.map((p) => [p.id, JSON.stringify(p)]))
  const newer = new Map(stale.map((p) => [p.id, p]))
  return projects.map((p) => (newer.has(p.id) && sentById.get(p.id) === JSON.stringify(p) ? newer.get(p.id)! : p))
}

/** Ids of the projects whose save or delete never reached the account. */
export type Unsent = { upserts: ReadonlySet<string>; deletes: ReadonlySet<string> }
export const NOTHING_UNSENT: Unsent = { upserts: new Set(), deletes: new Set() }
export const hasUnsent = (unsent: Unsent): boolean => unsent.upserts.size > 0 || unsent.deletes.size > 0

type Outgoing = { upserts: Project[]; deletes: string[] }

/**
 * What one save sends: its own change plus whatever failed before it, with every project as it stands in `next`, the
 * store that save was made from. A project that was edited then and deleted since is only deleted.
 */
export function outgoing(next: readonly Project[], change: { upserts: readonly Project[]; deletes: readonly string[] }, unsent: Unsent): Outgoing {
  const changed = new Set([...change.upserts.map((p) => p.id), ...unsent.upserts])
  const kept = new Set(next.map((p) => p.id))
  return {
    upserts: next.filter((p) => changed.has(p.id)),
    deletes: [...new Set([...change.deletes, ...unsent.deletes])].filter((id) => !kept.has(id)),
  }
}

/** A save that failed, as what the next one must carry. */
export function unsentOf(sent: Outgoing): Unsent {
  return { upserts: new Set(sent.upserts.map((p) => p.id)), deletes: new Set(sent.deletes) }
}

/** One copy per project id, the one stamped latest (the later in the list on a tie), in the order ids first appear. */
export function newestById(projects: readonly Project[]): Project[] {
  const newest = new Map<string, Project>()
  for (const p of projects) {
    const seen = newest.get(p.id)
    if (!seen || p.updatedAt >= seen.updatedAt) newest.set(p.id, p)
  }
  return [...newest.values()]
}

/**
 * Whether a request may act on the signed-in account. `claimed` is the account its page was loaded for: a tab left
 * open across a sign-out and another account's sign-in still sends the first account's with the second one's cookie.
 * A page built before requests carried the claim sends none and is let through.
 */
export function isForAccount(claimed: string | undefined, signedIn: string): boolean {
  return claimed === undefined || claimed === signedIn
}

/**
 * What an import writes. Every browser starts with the same first project, stamped 0 until it is edited. One that was
 * never edited is nobody's work: it is stored only for an account that has no project yet, so a new account still
 * gets its first project. Sent to an account that has projects, it would add an empty one at every sign-in.
 */
export function importable(incoming: readonly Project[], accountHasProjects: boolean): Project[] {
  return accountHasProjects ? incoming.filter((p) => p.updatedAt > 0) : [...incoming]
}
