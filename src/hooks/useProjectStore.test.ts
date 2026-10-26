import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeEach, expect, test, vi, type MockInstance } from 'vitest'
import type { Locale } from '../i18n'
import { PENDING_KEY } from '../lib/persistence'
import { addProject, deleteProject, patchCurrent, selectProject, setQty } from '../lib/store'
import { account, accounts, clock, net, resetServer, session } from './fake-account-server'
import { byName, edit, fakeStorage, home, mount, names, openBrowser, storedStore, unmount, type FakeStorage } from './project-store-harness'
import { useProjectStore } from './useProjectStore'

// What happens to an account's projects when its session ends or another account signs in is in
// useProjectStore.accounts.test.ts.
vi.mock('../server/projects', () => import('./fake-account-server'))
// The language the root route loaded the page in.
const page = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return { useRootData: () => ({ user: server.pageUser(), locale: page.locale }) }
})

const ANA = { id: 'user-ana' }
const HOUR_MS = 3_600_000

let browser: FakeStorage
let logged: MockInstance<typeof console.error>

beforeEach(async () => {
  await unmount()
  resetServer()
  page.locale = 'en'
  browser = fakeStorage()
  openBrowser(browser)
  // Failed requests are logged by the hook; the tests that care read the spy.
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await unmount() })

/** The errors the hook logged under `message`. */
const logs = (message: string) => logged.mock.calls.filter((call) => call[0] === message)

test('a save that never reached the account stays marked, and the next page load sends it before reading', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))
  net.offline = true
  await edit((h) => h.commit(setQty(h.store, 'fridge', 9)))
  const failed = await edit((h) => h.commit(addProject(h.store, 'Offline project')))
  expect(failed.syncError).toBe(true)
  expect(browser.getItem(PENDING_KEY)).toBe('1')
  expect(home(account(ANA)).qty.fridge).toBe(2)

  net.offline = false
  net.calls = []
  const reloaded = await mount()

  expect(net.calls).toEqual(['import'])
  expect(home(reloaded.store.projects).qty.fridge).toBe(9)
  expect(names(reloaded.store.projects)).toEqual(['Home', 'Offline project'])
  expect(home(account(ANA)).qty.fridge).toBe(9)
  expect(names(account(ANA))).toEqual(['Home', 'Offline project'])
  expect(reloaded.syncError).toBe(false)
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test('the next save carries what failed before it, and only then does the error clear', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  net.offline = true
  const failed = await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  expect(failed.syncError).toBe(true)

  net.offline = false
  const saved = await edit((h) => h.commit(setQty(selectProject(h.store, home(h.store.projects).id), 'tv', 3)))

  expect(byName(account(ANA), 'Second').hours).toBe(24)
  expect(home(account(ANA)).qty.tv).toBe(3)
  expect(saved.syncError).toBe(false)
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test('a delete that failed goes again with the next save', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  net.offline = true
  await edit((h) => h.commit(deleteProject(h.store)))
  expect(names(account(ANA))).toEqual(['Home', 'Second'])

  net.offline = false
  const saved = await edit((h) => h.commit(setQty(h.store, 'tv', 3)))

  expect(names(account(ANA))).toEqual(['Home'])
  expect(names(saved.store.projects)).toEqual(['Home'])
  expect(saved.syncError).toBe(false)
})

test('a project edited and then deleted while saves fail is not sent back to the account', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  await edit((h) => h.commit(deleteProject(h.store)))

  net.offline = false
  await edit((h) => h.commit(setQty(h.store, 'tv', 3)))

  expect(names(account(ANA))).toEqual(['Home'])
})

test('while saves keep failing the error and the marker stay, and each failure is logged', async () => {
  session.user = ANA
  await mount()
  net.offline = true

  await edit((h) => h.commit(setQty(h.store, 'fridge', 4)))
  const failed = await edit((h) => h.commit(setQty(h.store, 'tv', 2)))

  expect(failed.syncError).toBe(true)
  expect(failed.saving).toBe(false)
  expect(browser.getItem(PENDING_KEY)).toBe('1')
  expect(storedStore(browser)?.projects[0]?.qty).toMatchObject({ fridge: 4, tv: 2 })
  expect(logs('[projects] save failed')).toHaveLength(2)
})

test('after a load that failed, a save that works does not pass for a clean state', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  const offline = await mount()
  expect(offline.syncError).toBe(true)
  expect(logs('[projects] load failed')).toHaveLength(1)

  net.offline = false
  const saved = await edit((h) => h.commit(setQty(selectProject(h.store, home(h.store.projects).id), 'tv', 3)))

  // Home's edit is saved, but Second's never went: the load that would have sent it failed.
  expect(home(account(ANA)).qty.tv).toBe(3)
  expect(byName(account(ANA), 'Second').hours).toBe(10)
  expect(saved.syncError).toBe(true)
  expect(browser.getItem(PENDING_KEY)).toBe('1')

  const reloaded = await mount()

  expect(byName(account(ANA), 'Second').hours).toBe(24)
  expect(reloaded.syncError).toBe(false)
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test('a device whose clock ran ahead does not lock its project against later edits', async () => {
  session.user = ANA
  await mount()
  const realNow = Date.now.bind(Date)
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + HOUR_MS)
  await edit((h) => h.commit(setQty(h.store, 'fridge', 3)))
  expect(home(account(ANA)).updatedAt).toBeLessThanOrEqual(clock.now())

  vi.mocked(Date.now).mockRestore()
  await edit((h) => h.commit(setQty(h.store, 'fridge', 5)))

  expect(home(account(ANA)).qty.fridge).toBe(5)
  const reloaded = await mount()
  expect(home(reloaded.store.projects).qty.fridge).toBe(5)
})

test('an edit the account refuses as older is replaced on screen by the newer copy it holds', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))
  // Another device saves the same project, and this device's clock is ten minutes slow.
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 20, updatedAt: clock.now() })))
  const realNow = Date.now.bind(Date)
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() - HOUR_MS / 6)

  const refused = await edit((h) => h.commit(patchCurrent(h.store, { hours: 5 })))

  expect(home(account(ANA)).hours).toBe(20)
  expect(home(refused.store.projects).hours).toBe(20)
  expect(storedStore(browser)?.projects[0]?.hours).toBe(20)
  expect(refused.syncError).toBe(false)
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test('two quick hours edits the account refuses end on its hours, and the rename made with the second is kept', async () => {
  session.user = ANA
  await mount()
  // Another device set the hours later than these edits; nobody else renamed the project.
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 20, updatedAt: clock.now() + HOUR_MS })))
  net.calls = []

  const after = await edit((h) => {
    h.commit(patchCurrent(h.store, { hours: 5 }))
    h.commit(patchCurrent(h.store, { hours: 6, name: 'Renamed since' }))
  })

  expect(net.calls).toEqual(['save', 'save'])
  expect(account(ANA).map((p) => [p.name, p.hours])).toEqual([['Renamed since', 20]])
  expect(after.store.projects.map((p) => [p.name, p.hours])).toEqual([['Renamed since', 20]])
  expect(after.syncError).toBe(false)
})

test('when the delete fails and the save beside it works, both go again with the next save', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  await edit((h) => h.commit(addProject(h.store, 'Third')))
  net.failing = new Set(['delete'])
  // One change that edits Home and deletes the open project, Third.
  const failed = await edit((h) => h.commit(setQty(deleteProject(h.store), 'tv', 3)))
  expect(failed.syncError).toBe(true)
  expect(names(account(ANA))).toEqual(['Home', 'Second', 'Third'])
  expect(home(account(ANA)).qty.tv).toBe(3)

  net.failing = new Set()
  net.calls = []
  const saved = await edit((h) => h.commit(patchCurrent(selectProject(h.store, byName(h.store.projects, 'Second').id), { hours: 24 })))

  expect([...net.calls].sort()).toEqual(['delete', 'save'])
  expect(names(account(ANA))).toEqual(['Home', 'Second'])
  expect(byName(account(ANA), 'Second').hours).toBe(24)
  expect(saved.syncError).toBe(false)
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test('a save answered after its page was left writes nothing over the page that replaced it', async () => {
  session.user = ANA
  await mount()
  // The account holds a newer Home, so the save below is refused and answered with that copy.
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 20, updatedAt: clock.now() + HOUR_MS })))
  let answerFirst!: () => void
  net.gate = new Promise<void>((resolve) => { answerFirst = resolve })
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 5 })))

  // The user leaves and comes back: a new page, which reads the account and then adds a project.
  net.gate = null
  await mount()
  let answerSecond!: () => void
  net.gate = new Promise<void>((resolve) => { answerSecond = resolve })
  await edit((h) => h.commit(addProject(h.store, 'Made on the new page')))

  answerFirst()
  const duringSecondSave = await edit(() => undefined)

  expect(names(storedStore(browser)?.projects ?? [])).toEqual(['Home', 'Made on the new page'])
  expect(names(duringSecondSave.store.projects)).toEqual(['Home', 'Made on the new page'])
  // The new page's save is still in flight: its marker is not the old page's to clear.
  expect(browser.getItem(PENDING_KEY)).toBe('1')

  answerSecond()
  await edit(() => undefined)

  expect(names(account(ANA))).toEqual(['Home', 'Made on the new page'])
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test('a page in Spanish names its first project in Spanish', async () => {
  page.locale = 'es'

  const loaded = await mount()

  expect(names(loaded.store.projects)).toEqual(['Casa'])
})

test('a first project nobody edited reads in the language of the page, beside a project named by hand', async () => {
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Taller')))
  expect(names(storedStore(browser)?.projects ?? [])).toEqual(['Home', 'Taller'])

  page.locale = 'es'
  const inSpanish = await mount()

  expect(names(inSpanish.store.projects)).toEqual(['Casa', 'Taller'])
})

test("signed in, the account's first project nobody edited reads in the language of the page, and nothing is sent for it", async () => {
  session.user = ANA
  await mount()
  expect(names(account(ANA))).toEqual(['Home'])

  page.locale = 'es'
  net.calls = []
  const inSpanish = await mount()

  expect(names(inSpanish.store.projects)).toEqual(['Casa'])
  expect(net.calls).toEqual(['list'])
  expect(names(account(ANA))).toEqual(['Home'])
})

test("the account's first project edited on another device is shown, not this browser's untouched copy of it in another language", async () => {
  session.user = ANA
  await mount()
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, name: 'Quinta', hours: 20, updatedAt: clock.now() })))

  page.locale = 'es'
  const inSpanish = await mount()

  expect(names(inSpanish.store.projects)).toEqual(['Quinta'])
  expect(inSpanish.store.projects[0]!.hours).toBe(20)
})

test('signed in, the page as the server renders it is still syncing, so nothing acts on a project before it reaches the account', () => {
  // The page shows this markup before it hydrates; an upload picked then would name a project the account has not got yet.
  const syncingOnFirstRender = (): boolean => {
    let syncing: boolean | null = null
    const Probe = () => { syncing = useProjectStore().syncing; return null }
    renderToStaticMarkup(createElement(Probe))
    return syncing!
  }
  session.user = ANA
  const signedIn = syncingOnFirstRender()
  session.user = null
  const signedOut = syncingOnFirstRender()

  expect({ signedIn, signedOut }).toEqual({ signedIn: true, signedOut: false })
})
