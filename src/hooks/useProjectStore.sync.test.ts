// useProjectStore with the same account open in two tabs of one browser, or on two devices: an edit made in one is
// not undone by the next edit made in the other.
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import { clearPendingSave, markPendingSave, OWNER_KEY } from '../lib/persistence'
import type { Store } from '../lib/schema'
import { addProject, patchCurrent } from '../lib/store'
import { account, accounts, clock, net, resetServer, session } from './fake-account-server'
import { comeBack, edit, fakeStorage, home, mount, names, openBrowser, otherTabKeeps, storedStore, unmount, type FakeStorage } from './project-store-harness'

vi.mock('../server/projects', () => import('./fake-account-server'))
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return { useRootData: () => ({ session: server.pageSession(), locale: 'en' }) }
})

const ANA = { id: 'user-ana' }
const BOB = { id: 'user-bob' }
/** The volts an edit here picks: not the 48 V a new project starts with, as an edit to that changes only the stamp. */
const VOLTS = 24

let browser: FakeStorage

beforeEach(async () => {
  await unmount()
  resetServer()
  browser = fakeStorage()
  openBrowser(browser)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await unmount() })

/**
 * Another tab of this browser, open on Ana's account, commits `change` as useProjectStore's commit does: it keeps the
 * result here and marks its save as on its way, and only then does this tab hear of it. `land` is that save reaching
 * her account, after which that tab clears the marker.
 */
async function otherTabCommits(change: (store: Store) => Store) {
  const next = change(storedStore(browser)!)
  markPendingSave(browser)
  const shown = await otherTabKeeps(browser, next)
  const land = () => {
    accounts.set(ANA.id, structuredClone(next.projects))
    clearPendingSave(browser)
  }
  return { shown, land }
}

test("hours changed in another tab show here, stay when this tab comes back before that tab's save lands, and volts changed here next keep them, in the account and after a reload", async () => {
  session.user = ANA
  await mount()

  const tabA = await otherTabCommits((store) => patchCurrent(store, { hours: 20 }))
  expect(home(tabA.shown.store.projects).hours).toBe(20)
  // Editing volts here takes a focus first; a read made on coming back would answer before tab A's save lands.
  const back = await comeBack()
  tabA.land()
  await edit((h) => h.commit(patchCurrent(h.store, { volts: VOLTS })))

  expect(home(back.store.projects).hours).toBe(20)
  expect(home(account(ANA))).toMatchObject({ hours: 20, volts: VOLTS })
  const reloaded = await mount()
  expect(home(reloaded.store.projects)).toMatchObject({ hours: 20, volts: VOLTS })
})

test('hours 15 then 20 queued here stay at 20, on screen and in the account, when another tab keeps a copy from before them', async () => {
  session.user = ANA
  const loaded = await mount()
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 15 })))
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 20 })))

  await otherTabKeeps(browser, loaded.store)
  net.gate = null
  answer()
  const after = await edit(() => undefined)

  expect({ screen: home(after.store.projects).hours, account: home(account(ANA)).hours }).toEqual({ screen: 20, account: 20 })
})

test("a copy another tab keeps for another account is not shown here", async () => {
  session.user = ANA
  await mount()
  const mine = await edit((h) => h.commit(patchCurrent(h.store, { hours: 20 })))

  browser.setItem(OWNER_KEY, BOB.id)
  const after = await otherTabKeeps(browser, addProject(mine.store, "Bob's cabin"))

  expect(after.store).toEqual(mine.store)
})

test.each(['focus', 'visibilitychange'] as const)(
  "another device's saved hours show once this tab is back (%s), and volts changed here next keep them",
  async (event) => {
    session.user = ANA
    await mount()
    accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 20, updatedAt: clock.now() })))

    const back = await comeBack(event)
    expect(home(back.store.projects).hours).toBe(20)
    await edit((h) => h.commit(patchCurrent(h.store, { volts: VOLTS })))

    expect(home(account(ANA))).toMatchObject({ hours: 20, volts: VOLTS })
  },
)

test('an edit made here while the account is read again stays on screen and reaches the account', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  accounts.set(ANA.id, account(ANA).map((p) => (p.name === 'Home' ? { ...p, hours: 20, updatedAt: clock.now() } : p)))
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })

  await comeBack()
  await edit((h) => h.commit(patchCurrent(h.store, { name: 'Second renamed' })))
  net.gate = null
  answer()
  const after = await edit(() => undefined)

  expect(names(after.store.projects)).toEqual(['Home', 'Second renamed'])
  expect(home(after.store.projects).hours).toBe(20)
  expect(names(account(ANA))).toEqual(['Home', 'Second renamed'])
})

test("the click that brings this tab back edits volts, and the hours another device saved stay, on screen and in the account", async () => {
  session.user = ANA
  await mount()
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 20, updatedAt: clock.now() })))
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })

  await comeBack()
  await edit((h) => h.commit(patchCurrent(h.store, { volts: VOLTS })))
  net.gate = null
  answer()
  const after = await edit(() => undefined)

  expect({ screen: home(after.store.projects), account: home(account(ANA)) }).toMatchObject({
    screen: { hours: 20, volts: VOLTS },
    account: { hours: 20, volts: VOLTS },
  })
})

test('coming back while an edit has not reached the account reads nothing and keeps that edit', async () => {
  session.user = ANA
  await mount()
  net.offline = true
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 30 })))
  net.offline = false
  net.calls = []

  const back = await comeBack()

  expect(net.calls).toEqual([])
  expect(home(back.store.projects).hours).toBe(30)
})

test('an edit whose save is on its way when this tab comes back, and then fails, stays on screen, and the next save carries it', async () => {
  session.user = ANA
  await mount()
  net.calls = []
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })
  // The save is in flight when this tab is left and come back to, so no read goes out, and then the save fails.
  await edit((h) => h.commit(patchCurrent(h.store, { hours: 30 })))
  await comeBack()
  expect(net.calls).not.toContain('list')
  net.failing = new Set(['save'])
  net.gate = null
  answer()
  const failed = await edit(() => undefined)

  expect(home(failed.store.projects).hours).toBe(30)
  expect(failed.syncError).toBe(true)
  net.failing = new Set()
  await edit((h) => h.commit(patchCurrent(h.store, { volts: VOLTS })))
  expect(home(account(ANA))).toMatchObject({ hours: 30, volts: VOLTS })
})

test('a read that fails when this tab is back is logged and changes nothing on screen', async () => {
  session.user = ANA
  const loaded = await mount()
  net.failing = new Set(['list'])

  const back = await comeBack()

  expect(back.store).toEqual(loaded.store)
  expect(back.syncError).toBe(false)
  expect(vi.mocked(console.error).mock.calls.filter((call) => call[0] === '[projects] reload failed')).toHaveLength(1)
})

test("this tab's own save lands while another tab's hours save is on its way; coming back here shows those hours, and volts here keep them", async () => {
  const realNow = Date.now.bind(Date)
  let t = realNow()
  vi.spyOn(Date, 'now').mockImplementation(() => (t += 10))
  session.user = ANA
  await mount()
  let answer!: () => void
  net.gate = new Promise<void>((resolve) => { answer = resolve })
  await edit((h) => h.commit(patchCurrent(h.store, { chemistry: 'agm' })))
  const tabA = await otherTabCommits((store) => patchCurrent(store, { hours: 20 }))
  net.gate = null
  answer()
  await edit(() => undefined)

  const back = await comeBack()
  tabA.land()
  await edit((h) => h.commit(patchCurrent(h.store, { volts: VOLTS })))

  expect({ screen: home(back.store.projects).hours, account: home(account(ANA)) }).toMatchObject({
    screen: 20,
    account: { hours: 20, volts: VOLTS, chemistry: 'agm' },
  })
})

test("a project another tab added stays here when this tab comes back before that tab's save lands", async () => {
  session.user = ANA
  await mount()
  const tabA = await otherTabCommits((store) => addProject(store, 'Cabin'))

  const back = await comeBack()
  tabA.land()

  expect(names(back.store.projects)).toEqual(['Home', 'Cabin'])
})

test('a project another device deleted leaves the screen when this tab comes back', async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  accounts.set(ANA.id, account(ANA).filter((p) => p.name === 'Home'))

  const back = await comeBack()

  expect(names(back.store.projects)).toEqual(['Home'])
})

test("a project another device deleted leaves the screen when this tab comes back, though another tab's save failed and left its marker", async () => {
  session.user = ANA
  await mount()
  await edit((h) => h.commit(addProject(h.store, 'Second')))
  markPendingSave(browser)
  accounts.set(ANA.id, account(ANA).filter((p) => p.name === 'Home'))

  const back = await comeBack()
  await edit((h) => h.commit(patchCurrent(h.store, { volts: VOLTS })))

  expect(names(back.store.projects)).toEqual(['Home'])
  expect(names(account(ANA))).toEqual(['Home'])
})

test("a project another tab added, which this tab then read from the account, leaves the screen once deleted elsewhere, marker or not", async () => {
  session.user = ANA
  await mount()
  const tabA = await otherTabCommits((store) => addProject(store, 'Cabin'))
  tabA.land()
  await comeBack()
  markPendingSave(browser)
  accounts.set(ANA.id, account(ANA).filter((p) => p.name === 'Home'))

  const back = await comeBack()

  expect(names(back.store.projects)).toEqual(['Home'])
})

test("another device's saved hours show when this tab comes back, though another tab's save failed and left its marker", async () => {
  session.user = ANA
  await mount()
  markPendingSave(browser)
  accounts.set(ANA.id, account(ANA).map((p) => ({ ...p, hours: 20, updatedAt: clock.now() })))

  const back = await comeBack()

  expect(home(back.store.projects).hours).toBe(20)
})
