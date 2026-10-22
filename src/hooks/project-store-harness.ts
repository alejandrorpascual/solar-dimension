// Runs the real useProjectStore under React in node, for tests: a browser is a fake localStorage, a page load is a
// mount, and leaving the kit builder (or reloading) is an unmount. The test file mocks the server functions and the
// root data with fake-account-server.ts.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { STORAGE_KEY } from '../lib/persistence'
import type { Store } from '../lib/schema'
import { prepareReactInNode, stubContainer } from './react-in-node'
import { useProjectStore } from './useProjectStore'

type Hook = ReturnType<typeof useProjectStore>

export function fakeStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    keys: () => [...data.keys()],
  }
}
export type FakeStorage = ReturnType<typeof fakeStorage>

/** Makes `storage` the browser the hook runs in from now on. */
export function openBrowser(storage: FakeStorage): void {
  const g = globalThis as Record<string, unknown>
  Object.defineProperty(g, 'localStorage', { value: storage, configurable: true, writable: true })
  prepareReactInNode()
}

let root: Root | null = null
let current: Hook | null = null
function Probe(): null {
  current = useProjectStore()
  return null
}

/** Lets queued promises and the hook's request chain run to the end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function mounted(): Hook {
  if (!current) throw new Error('the hook is not mounted: call mount() first')
  return current
}

/** Leaving the kit builder, or closing the page. */
export async function unmount(): Promise<void> {
  const mountedRoot = root
  root = null
  current = null
  if (mountedRoot) await act(async () => { mountedRoot.unmount() })
}

/** A page load, or coming back to the kit builder: mounts the hook and waits for its first sync. */
export async function mount(): Promise<Hook> {
  await unmount()
  const next = createRoot(stubContainer())
  root = next
  await act(async () => {
    next.render(createElement(Probe))
    await settle()
  })
  return mounted()
}

/** The mounted page rendered again without a page load, as when the root route's data is read again. */
export async function rerender(): Promise<Hook> {
  const mountedRoot = root
  if (!mountedRoot) throw new Error('the hook is not mounted: call mount() first')
  await act(async () => {
    mountedRoot.render(createElement(Probe))
    await settle()
  })
  return mounted()
}

/** One user action on the mounted page, and whatever requests it starts. */
export async function edit(action: (hook: Hook) => void): Promise<Hook> {
  await act(async () => {
    action(mounted())
    await settle()
  })
  return mounted()
}

export const storedStore = (storage: FakeStorage): Store | null => {
  const raw = storage.getItem(STORAGE_KEY)
  return raw ? (JSON.parse(raw) as Store) : null
}
export const names = (list: readonly { name: string }[]): string[] => list.map((p) => p.name)
export function byName<T extends { name: string }>(list: readonly T[], name: string): T {
  const found = list.find((p) => p.name === name)
  if (!found) throw new Error(`no project named ${name}`)
  return found
}
export const home = <T extends { name: string }>(list: readonly T[]): T => byName(list, 'Home')
