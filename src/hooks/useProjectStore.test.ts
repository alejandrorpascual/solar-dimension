import { afterAll, afterEach, beforeEach, expect, test, vi, type MockInstance } from 'vitest'
import { LEGACY_SYNCED_KEY, OWNER_KEY, PENDING_KEY, STORAGE_KEY, UNSENT_KEY_PREFIX, releaseAccountCopy } from '../lib/persistence'
import type { Project } from '../lib/schema'
import { addProject, deleteProject, initialStore, patchCurrent, selectProject, setQty } from '../lib/store'
import { accounts, clock, net, resetServer, session, tab } from './fake-account-server'
import { edit, fakeStorage, mount, names, openBrowser, storedStore, unmount, type FakeStorage } from './project-store-harness'

vi.mock('../server/projects', () => import('./fake-account-server'))
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return { useRootData: () => ({ user: server.pageUser() }) }
})

const ANA = { id: 'user-ana' }
const BEA = { id: 'user-bea' }
const DAY_MS = 86_400_000
/** A client of Ana's: the details that must not reach another person's screen or account. */
const CLIENT = { kind: 'person', country: 'US', name: 'Carlos Lopez', contact: '', docPrefix: '', doc: '18456789', phone: '555-0100', email: '', address: '1 Secret St' } as const
const HOUR_MS = 3_600_000

let browser: FakeStorage
let logged: MockInstance<typeof console.error>

beforeEach(async () => {
  await unmount()
  resetServer()
  browser = fakeStorage()
  openBrowser(browser)
  // Failed requests are logged by the hook; the tests that care read the spy.
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await unmount() })

const account = (user: { id: string }): Project[] => accounts.get(user.id) ?? []
const byName = (list: readonly Project[], name: string): Project => {
  const found = list.find((p) => p.name === name)
  if (!found) throw new Error(`no project named ${name}`)
  return found
}
const home = (list: readonly Project[]): Project => byName(list, 'Home')
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
  const saved = await edit((h) => h.commit(setQty(selectProject(h.store, 'p1'), 'tv', 3)))

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
  const saved = await edit((h) => h.commit(setQty(selectProject(h.store, 'p1'), 'tv', 3)))

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

test('two quick edits the account refuses both end on the copy the account holds', async () => {
  session.user = ANA
  await mount()
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 20, updatedAt: clock.now() + HOUR_MS })))
  net.calls = []

  const after = await edit((h) => {
    h.commit(patchCurrent(h.store, { hours: 5 }))
    h.commit(patchCurrent(h.store, { hours: 6, name: 'Renamed since' }))
  })

  expect(net.calls).toEqual(['save', 'save'])
  expect(home(account(ANA)).hours).toBe(20)
  expect(names(after.store.projects)).toEqual(['Home'])
  expect(after.store.projects[0]?.hours).toBe(20)
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

/** Everything this browser stores, as one string: what a person at the keyboard could read out of it. */
const everythingStored = (): string => browser.keys().map((key) => `${key}=${browser.getItem(key)}`).join('\n')
/** Ana signed in on this browser, with a client's project saved to her account. */
async function anaWithClient(): Promise<void> {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Clinic for Lopez')))
  await edit((h) => h.commit(patchCurrent(h.store, { requester: CLIENT })))
}
/** Bea's account as she left it on her own device: her first project, edited yesterday. */
function beaHasHerOwnHome(): void {
  accounts.set(BEA.id, [{ ...initialStore().projects[0]!, name: 'Bea house', hours: 6, updatedAt: clock.now() - DAY_MS }])
}

test("signing out takes the account's projects off the browser, and the next account receives none of them", async () => {
  beaHasHerOwnHome()
  await anaWithClient()

  releaseAccountCopy()
  session.user = null
  const signedOut = await mount()

  expect(names(signedOut.store.projects)).toEqual(['Home'])
  expect(everythingStored()).not.toMatch(/Lopez|18456789|Secret St/)

  session.user = BEA
  net.calls = []
  const bea = await mount()

  expect(account(BEA).map((p) => [p.id, p.name, p.hours])).toEqual([['p1', 'Bea house', 6]])
  expect(names(bea.store.projects)).toEqual(['Bea house'])
  expect(browser.getItem(OWNER_KEY)).toBe(BEA.id)
  expect(names(account(ANA))).toEqual(['Home', 'Clinic for Lopez'])
})

test('a session that ended without a sign-out is treated as one at the next page load', async () => {
  beaHasHerOwnHome()
  await anaWithClient()

  session.user = null
  const expired = await mount()

  expect(names(expired.store.projects)).toEqual(['Home'])
  expect(everythingStored()).not.toMatch(/Lopez|18456789|Secret St/)
  expect(net.calls.at(-1)).toBe('save')

  session.user = BEA
  await mount()

  expect(account(BEA).map((p) => [p.id, p.name, p.hours])).toEqual([['p1', 'Bea house', 6]])
})

test("an account that signs in over another account's copy receives none of it", async () => {
  beaHasHerOwnHome()
  await anaWithClient()

  session.user = BEA
  const bea = await mount()

  expect(account(BEA).map((p) => [p.id, p.name, p.hours])).toEqual([['p1', 'Bea house', 6]])
  expect(names(bea.store.projects)).toEqual(['Bea house'])
  expect(everythingStored()).not.toMatch(/Lopez|18456789|Secret St/)
})

test('what never reached the account is set aside when its session ends, shown to nobody, and sent at its next sign-in', async () => {
  await anaWithClient()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(10)

  net.offline = false
  session.user = null
  const expired = await mount()

  expect(names(expired.store.projects)).toEqual(['Home'])
  expect(browser.getItem(STORAGE_KEY) ?? '').not.toMatch(/Lopez/)
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toMatch(/Lopez/)

  session.user = BEA
  const bea = await mount()
  expect(names(account(BEA))).toEqual(['Home'])
  expect(names(bea.store.projects)).toEqual(['Home'])

  releaseAccountCopy()
  session.user = ANA
  const back = await mount()

  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(24)
  expect(names(back.store.projects)).toEqual(['Home', 'Clinic for Lopez'])
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toBeNull()
  expect(back.syncError).toBe(false)
})

test('what was set aside stays set aside while the sign-in that would send it cannot reach the account', async () => {
  await anaWithClient()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  session.user = null
  await mount()

  session.user = ANA
  const offline = await mount()

  expect(offline.syncError).toBe(true)
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toMatch(/Lopez/)

  net.offline = false
  await mount()

  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(24)
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toBeNull()
})

test("work done signed out becomes the account's at a first sign-in", async () => {
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Tried before signing up')))

  session.user = ANA
  const signedIn = await mount()

  expect(names(account(ANA))).toEqual(['Home', 'Tried before signing up'])
  expect(names(signedIn.store.projects)).toEqual(['Home', 'Tried before signing up'])
  expect(browser.getItem(OWNER_KEY)).toBe(ANA.id)
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test("a first project edited signed out is added beside the account's own first project, not over it", async () => {
  accounts.set(ANA.id, [{ ...initialStore().projects[0]!, name: 'Ana house', hours: 6, updatedAt: clock.now() - DAY_MS }])
  await mount()
  await edit((h) => h.commit(patchCurrent(h.store, { name: 'Trial', hours: 24 })))

  session.user = ANA
  const signedIn = await mount()

  expect(account(ANA).map((p) => [p.name, p.hours])).toEqual([['Ana house', 6], ['Trial', 24]])
  expect(names(signedIn.store.projects)).toEqual(['Ana house', 'Trial'])
  expect(signedIn.project.name).toBe('Trial')
})

test("an edit from a tab left open after another tab signed out is still the account's, and leaves with it", async () => {
  await anaWithClient()
  // Another tab signs out. This one still shows Ana's projects, and its saves no longer reach the account.
  releaseAccountCopy()
  net.offline = true

  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))

  expect(browser.getItem(OWNER_KEY)).toBe(ANA.id)
  expect(browser.getItem(PENDING_KEY)).toBe('1')

  net.offline = false
  session.user = null
  const reloaded = await mount()

  expect(names(reloaded.store.projects)).toEqual(['Home'])
  expect(browser.getItem(STORAGE_KEY) ?? '').not.toMatch(/Lopez/)
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toMatch(/Lopez/)
})

test('an account whose first project took a new id gets no empty Home at its next sign-in', async () => {
  await mount()
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))
  session.user = ANA
  await mount()
  expect(account(ANA).map((p) => [p.name, p.qty.fridge])).toEqual([['Home', 2]])

  releaseAccountCopy()
  session.user = null
  await mount()
  session.user = ANA
  const back = await mount()

  expect(account(ANA).map((p) => [p.name, p.qty.fridge])).toEqual([['Home', 2]])
  expect(back.store.projects).toHaveLength(1)
  expect(back.project.qty.fridge).toBe(2)
})

test('an account that deleted its first project does not get it back from a fresh browser', async () => {
  accounts.set(ANA.id, [{ ...initialStore().projects[0]!, id: 'b0b0b0b0-0000-4000-8000-000000000001', name: 'Real project', updatedAt: clock.now() - DAY_MS }])

  session.user = ANA
  const signedIn = await mount()

  expect(names(account(ANA))).toEqual(['Real project'])
  expect(names(signedIn.store.projects)).toEqual(['Real project'])
  expect(signedIn.project.name).toBe('Real project')
})

test('a new account that never edited anything still gets its first project, so quotes have a project to hang on', async () => {
  session.user = ANA
  const signedIn = await mount()

  expect(account(ANA).map((p) => [p.id, p.name])).toEqual([['p1', 'Home']])
  expect(signedIn.project.id).toBe('p1')
})

test('two devices that each built a kit in the first project while signed out both keep theirs after signing in', async () => {
  const laptop = browser
  const phone = fakeStorage()
  await mount()
  await edit((h) => h.commit(patchCurrent(h.store, { name: 'Farm house', hours: 24 })))
  openBrowser(phone)
  await mount()
  await edit((h) => h.commit(patchCurrent(h.store, { name: 'Flat in town', hours: 4 })))

  session.user = ANA
  openBrowser(laptop)
  await mount()
  openBrowser(phone)
  await mount()
  openBrowser(laptop)
  const laptopAgain = await mount()

  expect(account(ANA).map((p) => [p.name, p.hours])).toEqual([['Farm house', 24], ['Flat in town', 4]])
  expect(names(laptopAgain.store.projects)).toEqual(['Farm house', 'Flat in town'])
})

test('a second session end keeps what the first one set aside', async () => {
  await anaWithClient()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  session.user = null
  await mount()
  // Ana signs in while the account still cannot be reached, then her session ends again.
  session.user = ANA
  const offline = await mount()
  expect(names(offline.store.projects)).toEqual(['Home', 'Clinic for Lopez'])
  session.user = null
  await mount()

  net.offline = false
  session.user = ANA
  const back = await mount()

  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(24)
  expect(names(back.store.projects)).toEqual(['Home', 'Clinic for Lopez'])
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toBeNull()
})

/** A browser as the release before this one left it: Ana's projects, edited after she signed out, and its marker. */
async function browserLeftByEarlierRelease(): Promise<void> {
  await anaWithClient()
  browser.setItem(LEGACY_SYNCED_KEY, ANA.id)
  browser.removeItem(OWNER_KEY)
  const store = storedStore(browser)!
  const edited = { ...store, projects: store.projects.map((p) => (p.name === 'Clinic for Lopez' ? { ...p, hours: 24, updatedAt: clock.now() + 1 } : p)) }
  browser.setItem(STORAGE_KEY, JSON.stringify(edited))
  await unmount()
}

test('signed out on a browser an earlier release left, the account\'s projects leave the screen and are kept for it', async () => {
  await browserLeftByEarlierRelease()

  session.user = null
  const signedOut = await mount()

  expect(names(signedOut.store.projects)).toEqual(['Home'])
  expect(browser.getItem(STORAGE_KEY) ?? '').not.toMatch(/Lopez/)
  expect(browser.getItem(LEGACY_SYNCED_KEY)).toBeNull()

  session.user = ANA
  await mount()

  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(24)
})

test('signed in on a browser an earlier release left, edits made while signed out reach the account', async () => {
  await browserLeftByEarlierRelease()
  net.calls = []

  session.user = ANA
  const signedIn = await mount()

  expect(net.calls).toEqual(['import'])
  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(24)
  expect(byName(signedIn.store.projects, 'Clinic for Lopez').hours).toBe(24)
  expect(browser.getItem(OWNER_KEY)).toBe(ANA.id)
  expect(browser.getItem(PENDING_KEY)).toBeNull()
})

test("a tab left open across a sign-out and another account's sign-in cannot save into that account", async () => {
  beaHasHerOwnHome()
  await anaWithClient()
  // Another tab: Ana signs out and Bea signs in. This tab still shows Ana's projects and still believes it is hers.
  tab.user = ANA
  session.user = BEA

  const stale = await edit((h) => h.commit(setQty(selectProject(h.store, 'p1'), 'tv', 3)))

  expect(account(BEA).map((p) => [p.id, p.name, p.hours])).toEqual([['p1', 'Bea house', 6]])
  expect(stale.syncError).toBe(true)
  expect(browser.getItem(PENDING_KEY)).toBe('1')

  // The tab is loaded again, now for Bea: Ana's copy leaves, with her unsent edit set aside for her.
  delete tab.user
  const bea = await mount()

  expect(names(bea.store.projects)).toEqual(['Bea house'])
  expect(account(BEA).map((p) => [p.id, p.name, p.hours])).toEqual([['p1', 'Bea house', 6]])
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toMatch(/Lopez/)
})

test("a save answered after another tab released the copy writes it back as the account's, not as anybody's work", async () => {
  await anaWithClient()
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, updatedAt: clock.now() + HOUR_MS })))
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 5 })))

  // Another tab signs out while this tab's save, which the account will refuse as older, is in flight.
  releaseAccountCopy()
  net.gate = null
  answer()
  await edit(() => undefined)

  expect(browser.getItem(STORAGE_KEY)).toMatch(/Lopez/)
  expect(browser.getItem(OWNER_KEY)).toBe(ANA.id)

  session.user = null
  const signedOut = await mount()

  expect(names(signedOut.store.projects)).toEqual(['Home'])
  expect(browser.getItem(STORAGE_KEY) ?? '').not.toMatch(/Lopez/)
})
