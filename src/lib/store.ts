import { SIZING } from './catalog'
import { HOURS_MAX, HOURS_MIN, type CustomLoad, type Project, type Solar, type Store } from './schema'
import { SOLAR } from './solar'

export const DEFAULT_QTY: Record<string, number> = { fridge: 1, lights: 1, router: 1, tv: 1, phone: 2, laptop: 1 }
const DEFAULT_HOURS = 10
const DEFAULT_ROOF_M2 = 40
const ID_PREFIX = 'p'
const SEED_ID = `${ID_PREFIX}1`
const SEED_NAME = 'Home'

function nextId(projects: readonly Project[]): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const max = projects.reduce((m, p) => Math.max(m, Number(p.id.slice(ID_PREFIX.length)) || 0), 0)
  return `${ID_PREFIX}${max + 1}`
}

const now = (): number => Date.now()

function newProject(projects: readonly Project[], name?: string, id: string = nextId(projects), updatedAt: number = now()): Project {
  return { id, name: name ?? `Project ${projects.length + 1}`, qty: { ...DEFAULT_QTY }, custom: [], hours: DEFAULT_HOURS, volts: 48, chemistry: 'lifepo4', batteryUnit: null, solar: null, requester: null, updatedAt }
}

/** The seed project is stamped 0 so server and client render the same first store, and so any saved copy outranks it. */
export function initialStore(): Store {
  const p = newProject([], SEED_NAME, SEED_ID, 0)
  return { version: 1, projects: [p], currentId: p.id }
}

export function currentProject(store: Store): Project {
  return store.projects.find((p) => p.id === store.currentId) ?? store.projects[0]!
}

/** Edit one project by id, open or not. An unknown id leaves the store as it was. */
export function patchProject(store: Store, id: string, patch: Partial<Project>): Store {
  if (!store.projects.some((p) => p.id === id)) return store
  return { ...store, projects: store.projects.map((p) => (p.id === id ? { ...p, updatedAt: now(), ...patch } : p)) }
}

export function patchCurrent(store: Store, patch: Partial<Project>): Store {
  return patchProject(store, currentProject(store).id, patch)
}

export function addProject(store: Store, name?: string): Store {
  const p = newProject(store.projects, name)
  return { ...store, projects: [...store.projects, p], currentId: p.id }
}

export function duplicateProject(store: Store): Store {
  const src = currentProject(store)
  const copy: Project = { ...src, id: nextId(store.projects), name: `${src.name} copy`, qty: { ...src.qty }, custom: [...src.custom], updatedAt: now() }
  return { ...store, projects: [...store.projects, copy], currentId: copy.id }
}

export function deleteProject(store: Store): Store {
  if (store.projects.length <= 1) return store
  const id = currentProject(store).id
  const rest = store.projects.filter((p) => p.id !== id)
  return { ...store, projects: rest, currentId: rest[0]!.id }
}

export function selectProject(store: Store, id: string): Store {
  return store.projects.some((p) => p.id === id) ? { ...store, currentId: id } : store
}

/** A quantity as stored: a whole number from 0 to SIZING.MAX_QTY. */
export function clampQty(n: number): number {
  return Math.max(0, Math.min(SIZING.MAX_QTY, Math.trunc(n)))
}

/** A typed quantity: whole digits only, otherwise null so the field can put the previous value back. */
export function parseQty(text: string): number | null {
  const s = text.trim()
  return /^\d+$/.test(s) ? Number(s) : null
}

/** A backup window as stored: whole hours from HOURS_MIN to HOURS_MAX. */
export function clampHours(n: number): number {
  if (!Number.isFinite(n)) return HOURS_MIN
  return Math.max(HOURS_MIN, Math.min(HOURS_MAX, Math.trunc(n)))
}

export function setQtyIn(store: Store, id: string, itemId: string, n: number): Store {
  const p = store.projects.find((x) => x.id === id)
  if (!p) return store
  return patchProject(store, id, { qty: { ...p.qty, [itemId]: clampQty(n) } })
}

export function setQty(store: Store, itemId: string, n: number): Store {
  return setQtyIn(store, currentProject(store).id, itemId, n)
}

export function setHoursIn(store: Store, id: string, hours: number): Store {
  return patchProject(store, id, { hours: clampHours(hours) })
}

const activeQty = (qty: Record<string, number>) =>
  Object.entries(qty).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b))

/** Whether two versions of a project size the same kit: same window, same non-zero quantities, same custom loads. */
export function hasSameLoads(a: Project, b: Project): boolean {
  return a.hours === b.hours
    && JSON.stringify(activeQty(a.qty)) === JSON.stringify(activeQty(b.qty))
    && JSON.stringify(a.custom.map((c) => c.id)) === JSON.stringify(b.custom.map((c) => c.id))
}

/** Undo quick edits: bring back a snapshot's loads and window, keeping anything else changed since (a rename). */
export function restoreProject(store: Store, snapshot: Project): Store {
  return patchProject(store, snapshot.id, { qty: { ...snapshot.qty }, custom: [...snapshot.custom], hours: snapshot.hours })
}

export function addCustom(store: Store, item: CustomLoad): Store {
  const p = currentProject(store)
  return patchCurrent(store, { custom: [...p.custom, item], qty: { ...p.qty, [item.id]: 1 } })
}

export function removeCustom(store: Store, itemId: string): Store {
  const p = currentProject(store)
  const { [itemId]: _dropped, ...qty } = p.qty
  return patchCurrent(store, { custom: p.custom.filter((c) => c.id !== itemId), qty })
}

const DEFAULT_SOLAR: Solar = { roofM2: DEFAULT_ROOF_M2, panels: null, sunHours: SOLAR.DEFAULT_SUN_HOURS }

const snap = (n: number, step: number, lo: number, hi: number) => {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n / step) * step))
}

/** Turns panels on (keeping an earlier choice, else the defaults) or off. */
export function setSolarIn(store: Store, id: string, on: boolean): Store {
  const p = store.projects.find((x) => x.id === id)
  if (!p) return store
  return patchProject(store, id, { solar: on ? (p.solar ?? DEFAULT_SOLAR) : null })
}

function patchSolar(store: Store, id: string, patch: Partial<Solar>): Store {
  const p = store.projects.find((x) => x.id === id)
  if (!p?.solar) return store
  return patchProject(store, id, { solar: { ...p.solar, ...patch } })
}

export function withSolarRoof(store: Store, id: string, roofM2: number): Store {
  return patchSolar(store, id, { roofM2: snap(roofM2, SOLAR.ROOF_STEP, SOLAR.ROOF_RANGE[0], SOLAR.ROOF_RANGE[1]) })
}

export function withSolarSun(store: Store, id: string, sunHours: number): Store {
  return patchSolar(store, id, { sunHours: snap(sunHours, SOLAR.SUN_STEP, SOLAR.SUN_RANGE[0], SOLAR.SUN_RANGE[1]) })
}

/** A tapped count, or null to go back to the recommended one. The engine clamps it to the roof. */
export function withSolarPanels(store: Store, id: string, panels: number | null): Store {
  return patchSolar(store, id, { panels: panels === null ? null : Math.max(0, Math.trunc(panels)) })
}
