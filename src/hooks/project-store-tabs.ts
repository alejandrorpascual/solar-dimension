// Runs the real useProjectStore as several tabs at once, for tests: tabs of one browser share a fake localStorage and
// hear each other's writes as storage events, a tab in another browser is another device. The test file mocks the
// server functions and the root data with fake-account-server.ts.
import { AsyncLocalStorage } from 'node:async_hooks'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { STORAGE_KEY } from '../lib/persistence'
import type { Project, Store } from '../lib/schema'
import { patchCurrent } from '../lib/store'
import { net } from './fake-account-server'
import { stubContainer } from './react-in-node'
import { useProjectStore } from './useProjectStore'

type Hook = ReturnType<typeof useProjectStore>
type Tab = { name: string; browser: string; win: EventTarget; doc: EventTarget; root: Root | null; hook: Hook | null }

const tabs = new Map<string, Tab>()
const browsers = new Map<string, Map<string, string>>()
/** The tab whose code runs: async work keeps it in `context`, and code React runs outside it reads `stepTab`. */
const context = new AsyncLocalStorage<string>()
let stepTab: string | undefined
const running = (): Tab | undefined => tabs.get(context.getStore() ?? stepTab ?? '')
const quiet = new EventTarget()

function storageOf(tab: Tab) {
  const data = browsers.get(tab.browser)!
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value))
      if (key !== STORAGE_KEY) return
      // Browsers tell the other tabs after the writing task ends, never the tab that wrote.
      for (const other of tabs.values()) {
        if (other === tab || other.browser !== tab.browser || !other.root) continue
        setTimeout(() => context.run(other.name, () => other.win.dispatchEvent(Object.assign(new Event('storage'), { key: STORAGE_KEY }))), 0)
      }
    },
    removeItem: (key: string) => void data.delete(key),
  }
}

/** Opens `layout`'s tabs, each named with the browser it runs in, with nothing mounted yet. */
export function openTabs(layout: Record<string, string>): void {
  const g = globalThis as Record<string, unknown>
  g.window = g
  g.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(g, 'localStorage', {
    configurable: true,
    get: () => {
      const tab = running()
      if (!tab) throw new Error('localStorage read outside any tab')
      return storageOf(tab)
    },
  })
  const on = (which: 'win' | 'doc') => ({
    addEventListener: (type: string, fn: EventListener) => (running()?.[which] ?? quiet).addEventListener(type, fn),
    removeEventListener: (type: string, fn: EventListener) => (running()?.[which] ?? quiet).removeEventListener(type, fn),
  })
  Object.assign(g, on('win'))
  g.document = { ...on('doc'), visibilityState: 'visible' }
  net.caller = () => context.getStore() ?? stepTab ?? 'page'
  tabs.clear()
  browsers.clear()
  for (const [name, browser] of Object.entries(layout)) {
    if (!browsers.has(browser)) browsers.set(browser, new Map())
    tabs.set(name, { name, browser, win: new EventTarget(), doc: new EventTarget(), root: null, hook: null })
  }
}

/** Lets queued promises, the hook's request chain and storage events run to the end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function inTab(name: string, action: () => void): Promise<void> {
  const before = stepTab
  stepTab = name
  try {
    await context.run(name, () => act(async () => {
      action()
      await settle()
    }))
  } finally {
    stepTab = before
  }
}

function Probe({ name }: { name: string }): null {
  tabs.get(name)!.hook = useProjectStore()
  return null
}

const tabNamed = (name: string): Tab => {
  const tab = tabs.get(name)
  if (!tab) throw new Error(`no tab ${name}`)
  return tab
}

/** A page load in tab `name`, or a reload. */
export async function mountTab(name: string): Promise<void> {
  const tab = tabNamed(name)
  await closeTab(tab)
  const root = createRoot(stubContainer())
  tab.root = root
  await inTab(name, () => root.render(createElement(Probe, { name })))
}

async function closeTab(tab: Tab): Promise<void> {
  const root = tab.root
  tab.root = null
  tab.hook = null
  if (root) await inTab(tab.name, () => root.unmount())
}

export async function closeAll(): Promise<void> {
  for (const tab of tabs.values()) await closeTab(tab)
}

/** The user moves to tab `name`: its window gets focus. */
export const focusTab = (name: string): Promise<void> => inTab(name, () => tabNamed(name).win.dispatchEvent(new Event('focus')))

/** One edit to the open project in tab `name`. */
export const editIn = (name: string, patch: Partial<Project>): Promise<void> =>
  inTab(name, () => {
    const hook = tabNamed(name).hook!
    hook.commit(patchCurrent(hook.store, patch))
  })

/** Lets the held call at `index` reach the server and answer, and returns it as `tab:call`. */
export async function land(index: number): Promise<string> {
  const [held] = net.held!.splice(index, 1)
  await inTab(held!.by, () => held!.land())
  return `${held!.by}:${held!.call}`
}

export async function landAll(): Promise<void> {
  for (let guard = 0; net.held!.length && guard < 200; guard++) await land(0)
}

export const screenOf = (name: string): Store => tabNamed(name).hook!.store
