// useProjectStore while the account cannot be read (the database is down): someone may be signed in, but the page
// cannot tell who. What it does with the projects of whoever is signed in is in useProjectStore.accounts.test.ts.
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { addProject, setQty } from '../lib/store'
import { account, net, resetServer, session } from './fake-account-server'
import { edit, fakeStorage, home, mount, names, openBrowser, unmount, type FakeStorage } from './project-store-harness'

vi.mock('../server/projects', () => import('./fake-account-server'))
// What the root route read: during an outage it has no user and says the account was unreachable.
const page = vi.hoisted(() => ({ isAccountUnreachable: false }))
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return {
    useRootData: () => ({
      user: page.isAccountUnreachable ? null : server.pageUser(), locale: 'en', isAccountUnreachable: page.isAccountUnreachable,
    }),
  }
})

const ANA = { id: 'user-ana' }

let browser: FakeStorage

beforeEach(async () => {
  await unmount()
  resetServer()
  page.isAccountUnreachable = false
  browser = fakeStorage()
  openBrowser(browser)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await unmount() })

/** Everything this browser stores, as one string. */
const everythingStored = (): string => browser.keys().sort().map((key) => `${key}=${browser.getItem(key)}`).join('\n')

test("while the account cannot be read, the page starts empty, keeps its edits to itself and leaves the account's copy as it was", async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Clinic for Lopez')))
  const accountCopy = everythingStored()
  expect(accountCopy).toContain('Clinic for Lopez')

  page.isAccountUnreachable = true
  net.calls = []
  const opened = await mount()
  expect(names(opened.store.projects)).toEqual(['Home'])
  const startingFridges = home(opened.store.projects).qty.fridge
  const edited = await edit((h) => h.commit(setQty(h.store, 'fridge', 7)))
  expect(home(edited.store.projects).qty.fridge).toBe(7)
  expect(everythingStored()).toBe(accountCopy)

  const reloaded = await mount()
  expect(home(reloaded.store.projects).qty.fridge).toBe(startingFridges)
  expect(everythingStored()).toBe(accountCopy)
  expect(net.calls).toEqual([])

  page.isAccountUnreachable = false
  const back = await mount()
  expect(names(back.store.projects)).toEqual(['Home', 'Clinic for Lopez'])
  expect(names(account(ANA))).toEqual(['Home', 'Clinic for Lopez'])
})
