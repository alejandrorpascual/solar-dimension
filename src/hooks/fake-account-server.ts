// Test double for src/server/projects.ts: accounts held in memory, under the server's rules. The same input schema,
// the same stamp clamp, an update only when the incoming stamp is not older than the stored one (the upsert's
// setWhere), and a batch that names a project twice is refused, as Postgres refuses an upsert that would touch a row
// twice. A call without a session throws as requireUserId does.
import { z } from 'zod'
import { ProjectSchema, type Project } from '../lib/schema'
import { clampStamp } from '../lib/sync'

const ProjectsInput = z.object({ projects: z.array(ProjectSchema).max(200) })
type Call = 'list' | 'save' | 'import' | 'delete'

export const session: { user: { id: string } | null } = { user: null }
export const accounts = new Map<string, Project[]>()
/**
 * The connection. `offline` makes every call reject as fetch does without one, and `failing` only the calls it names.
 * A call made while `gate` is set answers once that promise resolves, so a test can leave a request in flight.
 */
export const net: { offline: boolean; failing: Set<Call>; gate: Promise<void> | null; calls: Call[] } = {
  offline: false, failing: new Set(), gate: null, calls: [],
}
// Captured before any test moves the device's clock: the server keeps its own time.
const realNow = Date.now.bind(Date)
export const clock = { now: realNow }

export function resetServer(): void {
  accounts.clear()
  net.offline = false
  net.failing = new Set()
  net.gate = null
  net.calls = []
  session.user = null
  clock.now = realNow
}

async function reach(call: Call): Promise<void> {
  net.calls.push(call)
  const gate = net.gate
  if (gate) await gate
  if (net.offline || net.failing.has(call)) throw new TypeError('Failed to fetch')
}

function accountId(): string {
  const id = session.user?.id
  if (!id) throw new Error('Unauthorized')
  return id
}
const rows = (): Project[] => accounts.get(accountId()) ?? []

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
  return new Set(accepted.map((p) => p.id))
}

export async function listProjects(): Promise<Project[]> {
  await reach('list')
  return structuredClone(rows())
}

export async function saveProjects({ data }: { data: { projects: Project[] } }): Promise<{ ok: true; stale: Project[] }> {
  await reach('save')
  const { projects } = ProjectsInput.parse(data)
  const written = upsertAll(projects)
  const refused = new Set(projects.filter((p) => !written.has(p.id)).map((p) => p.id))
  return { ok: true, stale: structuredClone(rows().filter((row) => refused.has(row.id))) }
}

export async function importProjects({ data }: { data: { projects: Project[] } }): Promise<Project[]> {
  await reach('import')
  upsertAll(ProjectsInput.parse(data).projects)
  return structuredClone(rows())
}

export async function deleteProjects({ data }: { data: { ids: string[] } }): Promise<{ ok: true }> {
  await reach('delete')
  accounts.set(accountId(), rows().filter((row) => !data.ids.includes(row.id)))
  return { ok: true }
}
