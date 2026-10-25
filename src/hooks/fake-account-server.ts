// Test double for src/server/projects.ts: accounts held in memory, under the server's rules. The same input schema,
// the same stamp clamp, an update only when the incoming stamp is not older than the stored one (the upsert's
// setWhere), a named field written only when the stamp sent for it is not older than that field's last write
// (upsertNamed's fieldStamps), a batch that names a project twice is refused, as Postgres refuses an upsert that would
// touch a row twice, and an import stores a never-edited first project only for an account with no project yet. A call
// without a session throws as requireUserId does, and one from a page loaded for another account as requireAccount does.
import { z } from 'zod'
import { ProjectSchema, type Project } from '../lib/schema'
import { clampStamp, importable, isForAccount, NAMEABLE, namedFields, parseNamed, type Nameable, type NamedEdits } from '../lib/sync'

const ProjectsInput = z.object({ account: z.string().min(1).optional(), projects: z.array(ProjectSchema).max(200) })
type Call = 'list' | 'save' | 'import' | 'delete'

type User = { id: string }
/** Whose cookie the browser holds: the account the server answers for. */
export const session: { user: User | null } = { user: null }
/**
 * The user the page was loaded for. It follows the session unless a test pins it, which is a tab left open while
 * another tab signed out or signed in as someone else.
 */
export const tab: { user?: User | null } = {}
export const pageUser = (): User | null => ('user' in tab ? tab.user ?? null : session.user)
export const accounts = new Map<string, Project[]>()
type Stamps = Readonly<Record<Nameable, number>>
/** By account, then project id: the copy this server last wrote, and the stamp of the edit that last wrote each field. */
const lastWrites = new Map<string, ReadonlyMap<string, { copy: Project; stamps: Stamps }>>()
/** What `user`'s account holds. */
export const account = (user: User): Project[] => accounts.get(user.id) ?? []
/** A call waiting in `net.held`: `by` is the tab that made it, and `land` lets it reach the server and answer. */
export type Held = { call: Call; by: string; land: () => void }

/**
 * The connection. `offline` makes every call reject as fetch does without one, and `failing` only the calls it names.
 * A call made while `gate` is set answers once that promise resolves, so a test can leave a request in flight. While
 * `held` is a list, every call waits in it until the test lands it, so a test can try each order calls land in.
 */
export const net: { offline: boolean; failing: Set<Call>; gate: Promise<void> | null; calls: Call[]; held: Held[] | null; caller: () => string } = {
  offline: false, failing: new Set(), gate: null, calls: [], held: null, caller: () => 'page',
}
// Captured before any test moves the device's clock: the server keeps its own time.
const realNow = Date.now.bind(Date)
export const clock = { now: realNow }

export function resetServer(): void {
  accounts.clear()
  lastWrites.clear()
  net.offline = false
  net.failing = new Set()
  net.gate = null
  net.calls = []
  net.held = null
  net.caller = () => 'page'
  session.user = null
  delete tab.user
  clock.now = realNow
}

async function reach(call: Call): Promise<void> {
  net.calls.push(call)
  const gate = net.gate
  if (gate) await gate
  const held = net.held
  if (held) await new Promise<void>((land) => held.push({ call, by: net.caller(), land }))
  if (net.offline || net.failing.has(call)) throw new TypeError('Failed to fetch')
}

function accountId(): string {
  const id = session.user?.id
  if (!id) throw new Error('Unauthorized')
  return id
}
function requireAccount(claimed: string | undefined): void {
  if (!isForAccount(claimed, accountId())) throw new Error('This page was loaded for another account')
}
const rows = (): Project[] => accounts.get(accountId()) ?? []
const isSame = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The stamp of the edit that last wrote each field of the stored `row`, as the column `fieldStamps` gives it. A field
 * that differs from the copy this server last wrote was written since by a test standing in for another device, as a
 * save naming the fields it changed: at the row's stamp. With no write of its own recorded, every field is at the row's.
 */
function stampsOf(row: Project): Stamps {
  const last = lastWrites.get(accountId())?.get(row.id)
  return Object.fromEntries(NAMEABLE.map((field) => [field, last && isSame(last.copy[field], row[field]) ? last.stamps[field] : row.updatedAt])) as Stamps
}
function recordWrite(id: string, write: { copy: Project; stamps: Stamps } | null): void {
  const writes = new Map(lastWrites.get(accountId()))
  if (write) writes.set(id, write)
  else writes.delete(id)
  lastWrites.set(accountId(), writes)
}

/** Writes what is not older than the stored copy and returns the ids it wrote. */
function upsertAll(list: Project[]): Set<string> {
  if (new Set(list.map((p) => p.id)).size !== list.length) throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time')
  const now = clock.now()
  const stored = new Map(rows().map((row) => [row.id, row]))
  const accepted = list
    .map((p) => ({ ...structuredClone(p), updatedAt: clampStamp(p.updatedAt, now) }))
    .filter((p) => p.updatedAt >= (stored.get(p.id)?.updatedAt ?? -Infinity))
  const replaced = new Map(accepted.map((p) => [p.id, p]))
  accounts.set(accountId(), [...rows().map((row) => replaced.get(row.id) ?? row), ...accepted.filter((p) => !stored.has(p.id))])
  // A whole save wrote every field at its own stamp.
  for (const p of accepted) recordWrite(p.id, { copy: p, stamps: Object.fromEntries(NAMEABLE.map((field) => [field, p.updatedAt])) as Stamps })
  return new Set(accepted.map((p) => p.id))
}

export async function listProjects(input?: { data?: { account?: string } }): Promise<Project[]> {
  await reach('list')
  requireAccount(input?.data?.account)
  return structuredClone(rows())
}

/** Writes the named fields of each stored project as upsertNamed does, and returns the ids whose named fields were all written. */
function upsertNamed(list: Project[], named: NamedEdits): Set<string> {
  const stored = new Map(rows().map((row) => [row.id, row]))
  const now = clock.now()
  const written = new Set<string>()
  const next = new Map(list.map((p) => {
    const row = stored.get(p.id)!
    const updatedAt = clampStamp(p.updatedAt, now)
    const stamps = stampsOf(row)
    const sent = named[p.id]!
    const fields = namedFields(sent)
    const stampSent = (field: Nameable) => Math.min(clampStamp(sent[field]!, now), updatedAt)
    const taken = fields.filter((field) => stampSent(field) >= stamps[field])
    const copy = { ...row, ...Object.fromEntries(taken.map((field) => [field, structuredClone(p[field])])), updatedAt: Math.max(row.updatedAt, updatedAt) } as Project
    recordWrite(p.id, { copy, stamps: { ...stamps, ...Object.fromEntries(taken.map((field) => [field, stampSent(field)])) } })
    if (taken.length === fields.length) written.add(p.id)
    return [p.id, copy]
  }))
  accounts.set(accountId(), rows().map((row) => next.get(row.id) ?? row))
  return written
}

export async function saveProjects({ data }: { data: { account?: string; projects: Project[]; named?: NamedEdits } }): Promise<{ ok: true; stale: Project[] }> {
  await reach('save')
  const { projects } = ProjectsInput.parse(data)
  const named = parseNamed(data.named)
  requireAccount(data.account)
  const stored = new Set(rows().map((row) => row.id))
  const byField = projects.filter((p) => named[p.id] && stored.has(p.id))
  const written = new Set([...upsertNamed(byField, named), ...upsertAll(projects.filter((p) => !byField.includes(p)))])
  const refused = new Set(projects.filter((p) => !written.has(p.id)).map((p) => p.id))
  return { ok: true, stale: structuredClone(rows().filter((row) => refused.has(row.id))) }
}

export async function importProjects({ data }: { data: { account?: string; projects: Project[] } }): Promise<Project[]> {
  await reach('import')
  const { projects } = ProjectsInput.parse(data)
  requireAccount(data.account)
  upsertAll(importable(projects, rows().length > 0))
  return structuredClone(rows())
}

export async function deleteProjects({ data }: { data: { account?: string; ids: string[] } }): Promise<{ ok: true }> {
  await reach('delete')
  requireAccount(data.account)
  accounts.set(accountId(), rows().filter((row) => !data.ids.includes(row.id)))
  for (const id of data.ids) recordWrite(id, null)
  return { ok: true }
}
