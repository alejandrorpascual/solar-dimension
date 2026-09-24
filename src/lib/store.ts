import { SIZING } from './catalog'
import type { CustomLoad, Project, Store } from './schema'

export const DEFAULT_QTY: Record<string, number> = { fridge: 1, lights: 1, router: 1, tv: 1, phone: 2, laptop: 1 }
const DEFAULT_HOURS = 10
const ID_PREFIX = 'p'
const SEED_ID = `${ID_PREFIX}1`
const SEED_NAME = 'Home'

function nextId(projects: readonly Project[]): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const max = projects.reduce((m, p) => Math.max(m, Number(p.id.slice(ID_PREFIX.length)) || 0), 0)
  return `${ID_PREFIX}${max + 1}`
}

function newProject(projects: readonly Project[], name?: string, id: string = nextId(projects)): Project {
  return { id, name: name ?? `Project ${projects.length + 1}`, qty: { ...DEFAULT_QTY }, custom: [], hours: DEFAULT_HOURS, volts: 48, chemistry: 'lifepo4' }
}

export function initialStore(): Store {
  const p = newProject([], SEED_NAME, SEED_ID)
  return { version: 1, projects: [p], currentId: p.id }
}

export function currentProject(store: Store): Project {
  return store.projects.find((p) => p.id === store.currentId) ?? store.projects[0]!
}

export function patchCurrent(store: Store, patch: Partial<Project>): Store {
  const id = currentProject(store).id
  return { ...store, projects: store.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

export function addProject(store: Store, name?: string): Store {
  const p = newProject(store.projects, name)
  return { ...store, projects: [...store.projects, p], currentId: p.id }
}

export function duplicateProject(store: Store): Store {
  const src = currentProject(store)
  const copy: Project = { ...src, id: nextId(store.projects), name: `${src.name} copy`, qty: { ...src.qty }, custom: [...src.custom] }
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

export function setQty(store: Store, itemId: string, n: number): Store {
  const p = currentProject(store)
  const qty = { ...p.qty, [itemId]: Math.max(0, Math.min(SIZING.MAX_QTY, Math.trunc(n))) }
  return patchCurrent(store, { qty })
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
