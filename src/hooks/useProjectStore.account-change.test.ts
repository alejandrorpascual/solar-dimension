// useProjectStore when the account changes under a mounted page, with no page load in between: the root route's data
// is read again and names another account. Nothing the tab knew of the first account's saves reaches the second's.
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { initialStore, patchCurrent, setQty } from '../lib/store'
import type { NamedEdits } from '../lib/sync'
import { account, accounts, clock, net, resetServer, session } from './fake-account-server'
import { edit, fakeStorage, mount, openBrowser, rerender, unmount } from './project-store-harness'

/** The fields each save this page sent named, in the order it sent them. */
const saves = vi.hoisted((): { named?: NamedEdits }[] => [])
vi.mock('../server/projects', async () => {
  const server = await import('./fake-account-server')
  const saveProjects: typeof server.saveProjects = (input) => {
    saves.push(input.data)
    return server.saveProjects(input)
  }
  return { ...server, saveProjects }
})
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return { useRootData: () => ({ user: server.pageUser(), locale: 'en' }) }
})

const ANA = { id: 'user-ana' }
const BEA = { id: 'user-bea' }
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

beforeEach(async () => {
  await unmount()
  resetServer()
  openBrowser(fakeStorage())
  saves.length = 0
  // Failed requests are logged by the hook.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await unmount() })

test("an edit whose save failed before the account changed is not named by the next account's first save", async () => {
  // Both accounts hold a project under the id every browser's first project has, so a save for one can reach the other.
  const first = initialStore().projects[0]!
  accounts.set(ANA.id, [{ ...first, name: 'Ana house', updatedAt: clock.now() - DAY_MS }])
  accounts.set(BEA.id, [{ ...first, name: 'Bea house', hours: 6, updatedAt: clock.now() - DAY_MS }])
  session.user = ANA
  await mount()
  net.failing = new Set(['save'])
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  net.failing = new Set()

  // Ana signs out and Bea signs in on another tab; this page reads the root route again and is now Bea's.
  session.user = BEA
  await rerender()
  // Bea's phone sets the hours after this page read her list.
  accounts.set(BEA.id, account(BEA).map((p) => ({ ...p, hours: 8, updatedAt: clock.now() - HOUR_MS })))
  saves.length = 0
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))

  expect(saves.map((save) => Object.keys(save.named?.[first.id] ?? {}))).toEqual([['qty']])
  expect(account(BEA).map((p) => [p.name, p.hours, p.qty.fridge])).toEqual([['Bea house', 8, 2]])
})

test("a save in flight when the account changed, which fails after it, is not carried by the next account's first save", async () => {
  const first = initialStore().projects[0]!
  accounts.set(ANA.id, [{ ...first, name: 'Ana house', updatedAt: clock.now() - DAY_MS }])
  accounts.set(BEA.id, [{ ...first, name: 'Bea house', hours: 6, updatedAt: clock.now() - DAY_MS }])
  session.user = ANA
  await mount()
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })
  net.failing = new Set(['save'])
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))

  // The account changes while Ana's save is out; it fails only after.
  session.user = BEA
  await rerender()
  net.gate = null
  answer()
  await edit(() => undefined)
  net.failing = new Set()
  accounts.set(BEA.id, account(BEA).map((p) => ({ ...p, hours: 8, updatedAt: clock.now() - HOUR_MS })))
  saves.length = 0
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))

  expect(saves.map((save) => Object.keys(save.named?.[first.id] ?? {}))).toEqual([['qty']])
  expect(account(BEA).map((p) => [p.name, p.hours, p.qty.fridge])).toEqual([['Bea house', 8, 2]])
})
