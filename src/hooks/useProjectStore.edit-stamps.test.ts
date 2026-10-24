// useProjectStore when one field is edited in two places within one save's round trip: whatever else a tab edits
// before its save goes out, the account keeps the later edit of that field (QA v5: W5, W5b, W6).
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import { ProjectSchema } from '../lib/schema'
import { accounts, net, resetServer, session } from './fake-account-server'
import { closeAll, editIn, focusTab, land, landAll, mountTab, openTabs, screenOf } from './project-store-tabs'

vi.mock('../server/projects', () => import('./fake-account-server'))
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return { useRootData: () => ({ user: server.pageUser(), locale: 'en' }) }
})

const ANA = { id: 'user-ana' }
const HOME = ProjectSchema.parse({ id: 'acct-home', name: 'Home', qty: {}, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4', updatedAt: 1000 })

const accountHome = () => {
  const home = accounts.get(ANA.id)!.find((p) => p.id === HOME.id)!
  return { hours: home.hours, volts: home.volts, chemistry: home.chemistry }
}
const heldCalls = () => net.held!.map((h) => `${h.by}:${h.call}`)

/** Tabs A and B share one browser; C is another device. Every edit is stamped 10 ms after the one before. */
async function open(layout: Record<string, string>): Promise<void> {
  await closeAll()
  resetServer()
  session.user = ANA
  accounts.set(ANA.id, [structuredClone(HOME)])
  openTabs(layout)
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10))
  net.held = []
  for (const name of Object.keys(layout)) {
    await mountTab(name)
    await landAll()
  }
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterAll(async () => {
  await closeAll()
  vi.restoreAllMocks()
})

test("QA-W5: 5 h in A as the click that brings A back, 12 h on C (later, saved first), then 12 V in A before A's read answers: the account keeps 12 h", async () => {
  await open({ A: 'laptop', C: 'phone' })
  await focusTab('A')
  await editIn('A', { hours: 5 })
  await editIn('C', { hours: 12 })
  expect(heldCalls()).toEqual(['A:list', 'C:save'])
  expect(await land(1)).toBe('C:save')
  await editIn('A', { volts: 12 })
  await landAll()

  expect(accountHome()).toMatchObject({ hours: 12, volts: 12 })
  expect(screenOf('A').projects[0]).toMatchObject({ hours: 12, volts: 12 })
})

test("QA-W5b: 5 h in A queued behind A's own AGM save, 12 h on C (later, saved first), then 12 V in A: the account keeps 12 h", async () => {
  await open({ A: 'laptop', C: 'phone' })
  await editIn('A', { chemistry: 'agm' })
  await editIn('A', { hours: 5 })
  await editIn('C', { hours: 12 })
  expect(heldCalls()).toEqual(['A:save', 'C:save'])
  expect(await land(1)).toBe('C:save')
  await editIn('A', { volts: 12 })
  await landAll()

  expect(accountHome()).toEqual({ hours: 12, volts: 12, chemistry: 'agm' })
})

test('QA-W6: 5 h in A whose save fails, 12 h on C (later, saved), then 12 V in A carries the 5 h: the account keeps 12 h', async () => {
  await open({ A: 'laptop', C: 'phone' })
  await editIn('A', { hours: 5 })
  net.failing = new Set(['save'])
  expect(await land(0)).toBe('A:save')
  net.failing = new Set()
  await editIn('C', { hours: 12 })
  expect(await land(0)).toBe('C:save')
  await editIn('A', { volts: 12 })
  await landAll()

  expect(accountHome()).toMatchObject({ hours: 12, volts: 12 })
  expect(screenOf('A').projects[0]).toMatchObject({ hours: 12, volts: 12 })
})

test("5 h in A, 12 h on C, then 7 h in B, which A shows before its 5 h is sent: A's late save does not take B's 7 h back, in the account or in B", async () => {
  await open({ A: 'laptop', B: 'laptop', C: 'phone' })
  // Each tab's read on coming back holds its next save behind it.
  await focusTab('A')
  await focusTab('B')
  await editIn('A', { hours: 5 })
  await editIn('C', { hours: 12 })
  expect(heldCalls()).toEqual(['A:list', 'B:list', 'C:save'])
  expect(await land(2)).toBe('C:save')
  // B shows A's 5 h; 7 h there is the latest edit, and A then shows it too.
  await editIn('B', { hours: 7 })
  expect(screenOf('A').projects[0]!.hours).toBe(7)
  expect(await land(0)).toBe('A:list')
  expect(heldCalls()).toEqual(['B:list', 'A:save'])
  expect(await land(1)).toBe('A:save')
  await landAll()

  expect(accountHome().hours).toBe(7)
  expect(screenOf('B').projects[0]!.hours).toBe(7)
})
