// The account's side of useProjectStore: whose projects a browser holds, and what happens to them when the session
// ends, another account signs in, or a tab is left open. Saving and retrying are in useProjectStore.test.ts.
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { LEGACY_SYNCED_KEY, OWNER_KEY, PENDING_KEY, STORAGE_KEY, UNSENT_KEY_PREFIX, releaseAccountCopy } from '../lib/persistence'
import { addProject, deleteProject, initialStore, patchCurrent, selectProject, setQty } from '../lib/store'
import { account, accounts, clock, net, resetServer, session, tab } from './fake-account-server'
import { byName, edit, fakeStorage, home, mount, names, openBrowser, storedStore, unmount, type FakeStorage } from './project-store-harness'

vi.mock('../server/projects', () => import('./fake-account-server'))
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return { useRootData: () => ({ session: server.pageSession(), locale: 'en' }) }
})

const ANA = { id: 'user-ana' }
const BEA = { id: 'user-bea' }
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
/** A client of Ana's: the details that must not reach another person's screen or account. */
const CLIENT = { kind: 'person', country: 'VE', name: 'Carlos Lopez', contact: '', docPrefix: 'V', doc: '18456789', phone: '555-0100', email: '', address: '1 Secret St' } as const

let browser: FakeStorage

beforeEach(async () => {
  await unmount()
  resetServer()
  browser = fakeStorage()
  openBrowser(browser)
  // Failed requests are logged by the hook.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await unmount() })

/** Everything this browser stores, as one string: what a person at the keyboard could read out of it. */
const everythingStored = (): string => browser.keys().map((key) => `${key}=${browser.getItem(key)}`).join('\n')
/**
 * Ana signed in on this browser, with a client's project saved to her account. Her first project has the id every
 * account's first project had before they took ids of their own: the same as Bea's, and stamped later.
 */
async function anaWithClient(): Promise<void> {
  accounts.set(ANA.id, [{ ...initialStore().projects[0]!, updatedAt: clock.now() - HOUR_MS }])
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Clinic for Lopez')))
  await edit((h) => h.commit(patchCurrent(h.store, { requester: CLIENT })))
  // The schema drops a client it does not accept, and the checks below would then pass on nothing.
  expect(byName(account(ANA), 'Clinic for Lopez').requester).toEqual(CLIENT)
}
const beaKeptHerOwn = () => expect(account(BEA).map((p) => [p.id, p.name, p.hours])).toEqual([['p1', 'Bea house', 6]])
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

  beaKeptHerOwn()
  expect(names(bea.store.projects)).toEqual(['Bea house'])
  expect(browser.getItem(OWNER_KEY)).toBe(BEA.id)
  expect(names(account(ANA))).toEqual(['Home', 'Clinic for Lopez'])
})

test('a session that ended without a sign-out is treated as one at the next page load', async () => {
  beaHasHerOwnHome()
  await anaWithClient()

  session.user = null
  net.calls = []
  const expired = await mount()

  expect(names(expired.store.projects)).toEqual(['Home'])
  expect(everythingStored()).not.toMatch(/Lopez|18456789|Secret St/)
  expect(net.calls).toEqual([])

  session.user = BEA
  await mount()

  beaKeptHerOwn()
})

test("an account that signs in over another account's copy receives none of it", async () => {
  beaHasHerOwnHome()
  await anaWithClient()

  session.user = BEA
  const bea = await mount()

  beaKeptHerOwn()
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
  expect(browser.getItem(PENDING_KEY)).not.toBeNull()

  net.offline = false
  session.user = null
  const reloaded = await mount()

  expect(names(reloaded.store.projects)).toEqual(['Home'])
  expect(browser.getItem(STORAGE_KEY) ?? '').not.toMatch(/Lopez/)
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toMatch(/Lopez/)

  session.user = ANA
  await mount()

  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(24)
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

  expect(names(account(ANA))).toEqual(['Home'])
  expect(signedIn.project.id).toBe(account(ANA)[0]!.id)
  // Not the id every browser starts with: sent under that one, an edit could land on another copy of the account's.
  expect(signedIn.project.id).not.toBe(initialStore().projects[0]!.id)
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

  beaKeptHerOwn()
  expect(stale.syncError).toBe(true)
  expect(browser.getItem(PENDING_KEY)).not.toBeNull()

  // The tab is loaded again, now for Bea: Ana's copy leaves, with her unsent edit set aside for her.
  delete tab.user
  const bea = await mount()

  expect(names(bea.store.projects)).toEqual(['Bea house'])
  beaKeptHerOwn()
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toMatch(/Lopez/)

  // Ana signs in here again: the edit the open tab could not save is hers, in her own first project.
  releaseAccountCopy()
  session.user = ANA
  await mount()

  expect(home(account(ANA)).qty.tv).toBe(3)
  beaKeptHerOwn()
})

test("a save answered after another tab released the copy writes it back as the account's, not as anybody's work", async () => {
  await anaWithClient()
  // Another device set the hours later than this tab's edit, so the account keeps its own.
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 7, updatedAt: clock.now() + HOUR_MS })))
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

/** A browser nobody has used: Bea signs in, and the account's answers wait until the returned function is called. */
async function beaSignsInWhileTheAccountIsSlow(): Promise<() => void> {
  beaHasHerOwnHome()
  session.user = BEA
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })
  await mount()
  return () => { net.gate = null; answer() }
}

test("an edit made before the account's list arrives is added beside the account's first project, not over it", async () => {
  const answer = await beaSignsInWhileTheAccountIsSlow()
  // The screen shows this browser's own first project meanwhile, and Bea adds a fridge to it.
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))

  answer()
  const loaded = await edit(() => undefined)

  expect(account(BEA).map((p) => [p.name, p.hours, p.qty.fridge])).toEqual([['Bea house', 6, 1], ['Home', 10, 2]])
  expect(names(loaded.store.projects)).toEqual(['Bea house', 'Home'])
  expect(loaded.syncError).toBe(false)
})

test("removing this browser's first project before the account's list arrives removes nothing from the account", async () => {
  const answer = await beaSignsInWhileTheAccountIsSlow()
  await edit((h) => h.commit(addProject(h.store, 'Workshop')))
  await edit((h) => h.commit(deleteProject(selectProject(h.store, h.store.projects[0]!.id))))

  answer()
  const loaded = await edit(() => undefined)

  expect(names(account(BEA))).toEqual(['Bea house', 'Workshop'])
  expect(names(loaded.store.projects)).toEqual(['Bea house', 'Workshop'])
})

test.each([
  ['its save reaches the account', new Set(['import'] as const)],
  ['only the next page load reaches the account', new Set(['import', 'save'] as const)],
])("after a sign-in that could not read the account, an edit to this browser's first project is added beside the account's own: %s", async (_how, failing) => {
  beaHasHerOwnHome()
  session.user = BEA
  net.failing = new Set(failing)
  const unread = await mount()
  expect(unread.syncError).toBe(true)

  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))
  net.failing = new Set()
  const reloaded = await mount()

  expect(account(BEA).map((p) => [p.name, p.hours, p.qty.fridge])).toEqual([['Bea house', 6, 1], ['Home', 10, 2]])
  expect(names(reloaded.store.projects)).toEqual(['Bea house', 'Home'])
})

test("a tab left open that comes back to the kit builder is refused the next account's list", async () => {
  beaHasHerOwnHome()
  await anaWithClient()
  // Another tab: Ana signs out and Bea signs in, so the browser now holds Bea's copy. This tab is still Ana's page.
  tab.user = ANA
  releaseAccountCopy()
  session.user = BEA
  browser.setItem(STORAGE_KEY, JSON.stringify({ version: 1, projects: account(BEA), currentId: 'p1' }))
  browser.setItem(OWNER_KEY, BEA.id)
  // Opening another project's card changes no project, so nothing is sent; the tab writes its copy back as Ana's.
  await edit((h) => h.commit(selectProject(h.store, 'p1')))

  // To the privacy page and back: the kit builder mounts again on a page that was loaded for Ana.
  const back = await mount()

  expect(back.syncError).toBe(true)
  expect(names(back.store.projects)).not.toContain('Bea house')
  expect(everythingStored()).not.toMatch(/Bea house/)
})

test("a tab left open across another account's sign-in cannot delete that account's first project", async () => {
  beaHasHerOwnHome()
  await anaWithClient()
  tab.user = ANA
  session.user = BEA

  const stale = await edit((h) => h.commit(deleteProject(selectProject(h.store, 'p1'))))

  beaKeptHerOwn()
  expect(stale.syncError).toBe(true)
})

test("a page loaded for one account that comes back to the kit builder after another signed in sends that account nothing", async () => {
  beaHasHerOwnHome()
  await anaWithClient()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  net.offline = false
  // Another tab: Ana signs out, which sets her unsent edit aside, and Bea signs in.
  releaseAccountCopy()
  tab.user = ANA
  session.user = BEA

  const stale = await mount()

  beaKeptHerOwn()
  expect(stale.syncError).toBe(true)
  expect(names(stale.store.projects)).not.toContain('Bea house')
})

test("set-aside work whose sign-in could not reach the account is still the account's: nobody else sees or receives it", async () => {
  beaHasHerOwnHome()
  await anaWithClient()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  session.user = null
  await mount()
  session.user = ANA
  await mount()

  session.user = null
  const signedOut = await mount()

  expect(names(signedOut.store.projects)).toEqual(['Home'])
  expect(browser.getItem(STORAGE_KEY) ?? '').not.toMatch(/Lopez/)

  net.offline = false
  session.user = BEA
  const bea = await mount()

  beaKeptHerOwn()
  expect(names(bea.store.projects)).toEqual(['Bea house'])
})

test("work a sign-in took for its account stays that account's when the sign-in could not reach it", async () => {
  beaHasHerOwnHome()
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Tried signed out')))
  net.offline = true
  session.user = ANA
  await mount()

  net.offline = false
  session.user = BEA
  const bea = await mount()

  beaKeptHerOwn()
  expect(names(bea.store.projects)).toEqual(['Bea house'])

  releaseAccountCopy()
  session.user = ANA
  const back = await mount()

  expect(names(account(ANA))).toEqual(['Home', 'Tried signed out'])
  expect(names(back.store.projects)).toEqual(['Home', 'Tried signed out'])
})

test('work done signed out still reaches the account when the first sign-in could not', async () => {
  accounts.set(ANA.id, [{ ...initialStore().projects[0]!, id: 'b0b0b0b0-0000-4000-8000-000000000001', name: 'Real project', updatedAt: clock.now() - DAY_MS }])
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Tried before signing in')))
  net.offline = true
  session.user = ANA
  const offline = await mount()
  expect(offline.syncError).toBe(true)

  net.offline = false
  const reloaded = await mount()

  expect(names(account(ANA))).toEqual(['Real project', 'Tried before signing in'])
  expect(names(reloaded.store.projects)).toEqual(['Real project', 'Tried before signing in'])
})

test("a first project edited signed out still goes beside the account's own when the first sign-in could not reach the account", async () => {
  accounts.set(ANA.id, [{ ...initialStore().projects[0]!, name: 'Ana house', hours: 6, updatedAt: clock.now() - DAY_MS }])
  await mount()
  await edit((h) => h.commit(patchCurrent(h.store, { name: 'Trial', hours: 24 })))
  net.offline = true
  session.user = ANA
  await mount()

  net.offline = false
  await mount()

  expect(account(ANA).map((p) => [p.name, p.hours])).toEqual([['Ana house', 6], ['Trial', 24]])
})

test("an unsent edit to the account's first project comes back with it at the next sign-in", async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))
  net.offline = true
  await edit((h) => h.commit(setQty(h.store, 'fridge', 7)))
  net.offline = false
  session.user = null
  await mount()

  session.user = ANA
  const back = await mount()

  expect(account(ANA).map((p) => [p.name, p.qty.fridge])).toEqual([['Home', 7]])
  expect(back.store.projects.map((p) => [p.name, p.qty.fridge])).toEqual([['Home', 7]])
})

test('an edit made after a sign-in that could not reach the account outranks the older copy still set aside', async () => {
  await anaWithClient()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  session.user = null
  await mount()
  session.user = ANA
  await mount()
  await edit((h) => h.commit(patchCurrent(selectProject(h.store, byName(h.store.projects, 'Clinic for Lopez').id), { hours: 30 })))

  net.offline = false
  const back = await mount()

  expect(byName(account(ANA), 'Clinic for Lopez').hours).toBe(30)
  expect(byName(back.store.projects, 'Clinic for Lopez').hours).toBe(30)
})

test('work done signed out after a session ended is kept beside what that session end set aside', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(setQty(h.store, 'fridge', 2)))
  net.offline = true
  await edit((h) => h.commit(setQty(h.store, 'fridge', 7)))
  net.offline = false
  session.user = null
  await mount()
  await edit((h) => h.commit(patchCurrent(h.store, { name: 'Trial', hours: 24 })))
  await edit((h) => h.commit(addProject(h.store, 'Made signed out')))

  session.user = ANA
  const back = await mount()

  expect(names(account(ANA)).sort()).toEqual(['Home', 'Made signed out', 'Trial'])
  expect(home(account(ANA)).qty.fridge).toBe(7)
  expect(names(back.store.projects).sort()).toEqual(['Home', 'Made signed out', 'Trial'])
})

test("a new account that signs in over another account's copy still gets its first project", async () => {
  await anaWithClient()

  session.user = BEA
  const bea = await mount()

  expect(names(account(BEA))).toEqual(['Home'])
  expect(names(bea.store.projects)).toEqual(['Home'])
})

test('when storage refuses the removal, the released copy is still shown to nobody and sent to nobody', async () => {
  beaHasHerOwnHome()
  await anaWithClient()
  await unmount()
  openBrowser({ ...browser, removeItem: () => { throw new Error('blocked') } })

  session.user = null
  const signedOut = await mount()
  expect(names(signedOut.store.projects)).toEqual(['Home'])
  // Still on this browser, so still Ana's: the next page load takes it off the screen again.
  const again = await mount()
  expect(names(again.store.projects)).toEqual(['Home'])

  session.user = BEA
  const bea = await mount()
  beaKeptHerOwn()
  expect(names(bea.store.projects)).toEqual(['Bea house'])
})

test("with nothing unsent the account's list replaces the copy: a project deleted on another device does not come back", async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  accounts.set(ANA.id, account(ANA).filter((p) => p.name !== 'Second'))

  const reloaded = await mount()

  expect(names(account(ANA))).toEqual(['Home'])
  expect(names(reloaded.store.projects)).toEqual(['Home'])
})

test("on a browser an earlier release left, with storage too full to mark the copy, the next account still receives none of it", async () => {
  beaHasHerOwnHome()
  await browserLeftByEarlierRelease()
  openBrowser({ ...browser, setItem: () => { throw new Error('QuotaExceededError') } })

  session.user = null
  const signedOut = await mount()
  expect(names(signedOut.store.projects)).toEqual(['Home'])

  session.user = BEA
  await mount()
  beaKeptHerOwn()
})

test('work set aside that cannot be read stays set aside after a sign-in that worked', async () => {
  session.user = ANA
  await mount()
  await unmount()
  const key = `${UNSENT_KEY_PREFIX}${ANA.id}`
  const unreadable = JSON.stringify({ version: 1, projects: [{ id: 'x' }], currentId: 'x' })
  browser.setItem(key, unreadable)

  const signedIn = await mount()

  expect(signedIn.syncError).toBe(false)
  expect(browser.getItem(key)).toBe(unreadable)
})

test('a sign-out with an unsent edit sets it aside, and the next sign-in sends it', async () => {
  session.user = ANA
  await mount()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 24 })))
  net.offline = false

  releaseAccountCopy()
  session.user = null
  await mount()

  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toMatch(/"hours":24/)
  expect(home(account(ANA)).hours).not.toBe(24)

  session.user = ANA
  const back = await mount()

  expect(home(account(ANA)).hours).toBe(24)
  expect(home(back.store.projects).hours).toBe(24)
  expect(browser.getItem(`${UNSENT_KEY_PREFIX}${ANA.id}`)).toBeNull()
})
