import { z } from 'zod'
import { ProjectSchema, type Project } from './schema'

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

/**
 * The account's list `base` with what was edited here between `before` and `after` laid over it field by field: a field
 * edited here takes the value edited here, and every other field keeps the account's, so an edit here does not undo
 * another device's edit to another field of the same project. A project added here, or gone from the account, is
 * taken whole. Ceiling: a field is the unit, so edits on two devices to one field (two appliances in `qty`) keep this one.
 */
export function rebase(base: readonly Project[], before: readonly Project[], after: readonly Project[]): Project[] {
  const beforeById = new Map(before.map((p) => [p.id, p]))
  const accountCopies = new Map(base.map((p) => [p.id, p]))
  const { upserts, deletes } = diffProjects(before, after)
  const edits = upserts.map((edited) => {
    const unedited = beforeById.get(edited.id)
    const accountCopy = accountCopies.get(edited.id)
    if (!unedited || !accountCopy) return edited
    const fields = new Set([...Object.keys(unedited), ...Object.keys(edited)]) as Set<keyof Project>
    const changed = [...fields].filter((field) => JSON.stringify(unedited[field]) !== JSON.stringify(edited[field]))
    return { ...accountCopy, ...Object.fromEntries(changed.map((field) => [field, edited[field]])) }
  })
  return applyChanges(base, { upserts: edits, deletes })
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
 * later save and stays on screen until the account answers it. A project the save named fields of (`named`) takes back
 * only the named fields the account kept at its own value, each where the screen still shows what was sent: the rest of
 * it may hold edits a later save carries.
 */
export function adoptStale(projects: readonly Project[], sent: readonly Project[], stale: readonly Project[], named: NamedEdits = {}): Project[] {
  const sentById = new Map(sent.map((p) => [p.id, p]))
  const newer = new Map(stale.map((p) => [p.id, p]))
  return projects.map((p) => {
    const account = newer.get(p.id)
    const copy = sentById.get(p.id)
    if (!account || !copy) return p
    const fields = named[p.id]
    if (!fields) return isSame(p, copy) ? account : p
    const refused = nameable(fields).filter((field) => !isSame(account[field], copy[field]) && isSame(p[field], copy[field]))
    return refused.length ? { ...p, ...Object.fromEntries(refused.map((field) => [field, account[field]])) } : p
  })
}

const isSame = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * What a tab shows once another tab of this browser kept `kept`: that tab's list, with this tab's copy of a project
 * (`projects`) where it is stamped later. The account's own rule, the later stamp wins and the incoming copy wins a tie,
 * so a tab never goes back to an older copy of a project, which a save queued here would then send. A project gone
 * from `kept` was deleted there.
 */
export function adoptKept(projects: readonly Project[], kept: readonly Project[]): Project[] {
  const here = new Map(projects.map((p) => [p.id, p]))
  return kept.map((p) => {
    const own = here.get(p.id)
    return own && own.updatedAt > p.updatedAt ? own : p
  })
}

/**
 * What a tab shows of the account's list read again (`list`), before the edits made during the read are laid over it:
 * adoptKept's rule, so a copy this browser stamped later (another tab's edit whose save has not landed) stays. A project
 * the account lacks leaves the screen, as another device deleted it, unless a save from this browser is on its way
 * (`isSaving`): it may be the one that save adds.
 */
export function readBack(projects: readonly Project[], list: readonly Project[], isSaving: boolean): Project[] {
  const listed = new Set(list.map((p) => p.id))
  return [...adoptKept(projects, list), ...(isSaving ? projects.filter((p) => !listed.has(p.id)) : [])]
}

/** Ids of the projects whose save or delete never reached the account. */
export type Unsent = { upserts: ReadonlySet<string>; deletes: ReadonlySet<string> }
export const NOTHING_UNSENT: Unsent = { upserts: new Set(), deletes: new Set() }
export const hasUnsent = (unsent: Unsent): boolean => unsent.upserts.size > 0 || unsent.deletes.size > 0

type Outgoing = { upserts: Project[]; deletes: string[] }

/**
 * What one save sends: its own change plus whatever failed before it, with every project as it stands in `next`, the
 * store the save is sent from. A project that was edited then and deleted since is only deleted.
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

type Field = keyof typeof ProjectSchema.shape

/** The fields ProjectSchema fills in when a project comes without them, read from the schema so a new one is covered. */
const DEFAULTED = (Object.keys(ProjectSchema.shape) as Field[]).filter((field) => ProjectSchema.shape[field].safeParse(undefined).success)

/** By project id, the fields a save left out. The account keeps its own value of each: the save's is only a default. */
export type LeftOut = ReadonlyMap<string, readonly Field[]>

/**
 * The fields each project of a save (`sent`, as the request carried it, before parsing) leaves out. A build older than
 * a field sends none of it, and its save must not clear what the account holds there. A field sent as null is carried:
 * a battery-only kit sends `solar: null`.
 */
export function leftOut(sent: readonly unknown[]): LeftOut {
  return new Map(sent.map((project) => {
    const fields: Record<string, unknown> = typeof project === 'object' && project !== null ? { ...project } : {}
    return [String(fields.id), DEFAULTED.filter((field) => fields[field] === undefined)]
  }))
}

/** The fields a save can name: every field but the key and the stamp, which every save carries. */
export type Nameable = Exclude<Field, 'id' | 'updatedAt'>
const NAMEABLE = (Object.keys(ProjectSchema.shape) as Field[]).filter((field): field is Nameable => field !== 'id' && field !== 'updatedAt')
export const isNameable = (field: string): field is Nameable => (NAMEABLE as string[]).includes(field)
const nameable = (starts: StartedFrom): Nameable[] => Object.keys(starts).filter(isNameable)

/** The fields an edit changed, each with the value it had before the edit. */
export type StartedFrom = Readonly<Partial<Record<Nameable, unknown>>>
/** By project id, what a save names: the account writes only those fields, each over the value it started from. */
export type NamedEdits = Readonly<Record<string, StartedFrom>>
/** By project id, the fields edits changed, or `all` for a project an edit added, which a save sends whole. */
export type Edits = ReadonlyMap<string, StartedFrom | 'all'>

/** What each project in `upserts` changed from its copy in `prev`. One that `prev` lacks is new: all of it. */
export function editsOf(prev: readonly Project[], upserts: readonly Project[]): Edits {
  const before = new Map(prev.map((p) => [p.id, p]))
  return new Map(upserts.map((p): [string, StartedFrom | 'all'] => {
    const old = before.get(p.id)
    if (!old) return [p.id, 'all']
    return [p.id, Object.fromEntries(NAMEABLE.filter((field) => !isSame(old[field], p[field])).map((field) => [field, old[field]]))]
  }))
}

/**
 * Edits that did not reach the account (`earlier`) and the ones made since (`later`), as one save carries them. A field
 * in both keeps its earlier start, the value the account last held; a project added in either goes whole.
 */
export function mergeEdits(earlier: Edits, later: Edits): Edits {
  const merged = new Map(earlier)
  for (const [id, starts] of later) {
    const had = merged.get(id)
    merged.set(id, had === 'all' || starts === 'all' ? 'all' : { ...starts, ...had })
  }
  return merged
}

/** What a save sending `sending` names. A project edited `all`, or one no edit names, is left out and goes whole. */
export function namedEdits(sending: readonly Project[], edits: Edits): NamedEdits {
  return Object.fromEntries(sending.flatMap((p) => {
    const starts = edits.get(p.id)
    return starts && starts !== 'all' ? [[p.id, starts]] : []
  }))
}

/**
 * The fields a save names as the request carried them, each starting value checked against that field's own schema. A
 * field a save cannot name, or a starting value its field would not hold, refuses the save, as a project that does
 * not parse does.
 */
export function parseNamed(raw: unknown): NamedEdits {
  const edits = z.record(z.string(), z.record(z.string(), z.unknown())).optional().parse(raw) ?? {}
  return Object.fromEntries(Object.entries(edits).map(([id, starts]) => [id, Object.fromEntries(Object.entries(starts).map(([field, value]) => {
    if (!isNameable(field)) throw new Error(`A save cannot name the field ${field}`)
    return [field, ProjectSchema.shape[field].parse(value)]
  }))]))
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
