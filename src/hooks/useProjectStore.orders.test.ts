// useProjectStore in two tabs of one browser and on a second device, in every order their steps and requests can
// happen: whichever order the saves land in, no edit is lost from the account, and every tab shows the account's copy
// once it comes back. Each order is replayed from a fresh start, so a failure names the exact order that broke.
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import { ProjectSchema, type Project } from '../lib/schema'
import { accounts, net, resetServer, session } from './fake-account-server'
import { closeAll, editIn, focusTab, land, landAll, mountTab, openTabs, screenOf } from './project-store-tabs'

vi.mock('../server/projects', () => import('./fake-account-server'))
vi.mock('./useRootData', async () => {
  const server = await import('./fake-account-server')
  return { useRootData: () => ({ session: server.pageSession(), locale: 'en' }) }
})

const ANA = { id: 'user-ana' }
const HOME = ProjectSchema.parse({ id: 'acct-home', name: 'Home', qty: {}, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4', updatedAt: 1000 })
/** Tabs A and B share one browser; C is another device. */
const LAYOUT = { A: 'laptop', B: 'laptop', C: 'phone' }
const FIELDS = ['hours', 'volts', 'chemistry'] as const
type Fields = Pick<Project, (typeof FIELDS)[number]>
type Step = { tab: string; edit: Partial<Fields> } | { tab: string; focus: true }

const fieldsOf = (projects: readonly Project[]): Fields => {
  const home = projects.find((p) => p.id === HOME.id)!
  return { hours: home.hours, volts: home.volts, chemistry: home.chemistry }
}
const accountFields = () => fieldsOf(accounts.get(ANA.id) ?? [])

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterAll(async () => {
  await closeAll()
  vi.restoreAllMocks()
})

async function start(names: readonly string[]): Promise<void> {
  await closeAll()
  resetServer()
  session.user = ANA
  accounts.set(ANA.id, [structuredClone(HOME)])
  openTabs(Object.fromEntries(names.map((name) => [name, LAYOUT[name as keyof typeof LAYOUT]])))
  let now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 10))
  net.held = []
  for (const name of names) {
    await mountTab(name)
    await landAll()
  }
}

/** Runs one order: `choices[i]` picks, at the i-th point, the next user step (0, while any is left) or a held call. */
async function runOrder(names: readonly string[], steps: readonly Step[], choices: readonly number[]) {
  await start(names)
  const taken: number[] = []
  const options: number[] = []
  const path: string[] = []
  let next = 0
  for (;;) {
    const stepsLeft = next < steps.length ? 1 : 0
    const count = stepsLeft + net.held!.length
    if (count === 0) break
    const choice = choices[taken.length] ?? 0
    taken.push(choice)
    options.push(count)
    if (stepsLeft && choice === 0) {
      const step = steps[next++]!
      if ('focus' in step) await focusTab(step.tab)
      else await editIn(step.tab, step.edit)
      path.push('focus' in step ? `${step.tab} focus` : `${step.tab} ${JSON.stringify(step.edit)}`)
    } else {
      path.push(await land(choice - stepsLeft))
    }
  }
  return { taken, options, path }
}

/** Every order of `steps`: returns the ones that lost an edit, and the ones where a tab came back to another copy. */
async function everyOrder(names: readonly string[], steps: readonly Step[]) {
  const want = { ...fieldsOf([HOME]), ...Object.assign({}, ...steps.map((step) => ('edit' in step ? step.edit : {}))) }
  const lost: string[] = []
  const stale: string[] = []
  let orders = 0
  let choices: number[] = []
  for (;;) {
    const { taken, options, path } = await runOrder(names, steps, choices)
    orders++
    const held = accountFields()
    if (FIELDS.some((f) => held[f] !== want[f])) lost.push(`${JSON.stringify(held)} via ${path.join(' > ')}`)
    for (const name of names) {
      await focusTab(name)
      await landAll()
      if (JSON.stringify(fieldsOf(screenOf(name).projects)) !== JSON.stringify(accountFields())) stale.push(`${name} via ${path.join(' > ')}`)
    }
    let at = taken.length - 1
    while (at >= 0 && taken[at]! + 1 >= options[at]!) at--
    if (at < 0) return { orders, lost, stale }
    choices = [...taken.slice(0, at), taken[at]! + 1]
  }
}

/** Moving to another tab or window gives it focus before the edit made there. */
function switching(steps: readonly Step[]): Step[] {
  return steps.flatMap((step, i) => (i > 0 && steps[i - 1]!.tab !== step.tab ? [{ tab: step.tab, focus: true as const }, step] : [step]))
}

const edit = (tab: string, change: Partial<Fields>): Step => ({ tab, edit: change })

test.each([
  ['two tabs: hours in A, then volts in B', ['A', 'B'], switching([edit('A', { hours: 24 }), edit('B', { volts: 12 })])],
  ["two tabs: AGM in B, hours in A, volts in B (QA-W1, B's own save lands while A's is on its way)", ['A', 'B'],
    switching([edit('B', { chemistry: 'agm' }), edit('A', { hours: 24 }), edit('B', { volts: 12 })])],
  ['two devices: hours on C, then volts in B', ['B', 'C'], switching([edit('C', { hours: 24 }), edit('B', { volts: 12 })])],
  ['two devices with no focus between: hours on C, volts in B', ['B', 'C'], [edit('C', { hours: 24 }), edit('B', { volts: 12 })]],
  ['one field in two tabs: 24 h in A, then 12 h in B, which is the later edit', ['A', 'B'], switching([edit('A', { hours: 24 }), edit('B', { hours: 12 })])],
  ['one field on two devices: 24 h on C, then 12 h in B, which is the later edit', ['B', 'C'], switching([edit('C', { hours: 24 }), edit('B', { hours: 12 })])],
  ['one field set back (QA-W4): 5 h in A, then 12 h and back to 10 h on C, which is the later edit', ['A', 'C'],
    switching([edit('A', { hours: 5 }), edit('C', { hours: 12 }), edit('C', { hours: 10 })])],
  ['QA-W5: 5 h in A as the click that brings A back, 12 h on C, then 12 V in A before A has sent its 5 h', ['A', 'C'],
    [{ tab: 'A', focus: true }, edit('A', { hours: 5 }), { tab: 'C', focus: true }, edit('C', { hours: 12 }), edit('A', { volts: 12 })]],
] as const)('%s: no order loses an edit, and each tab shows the account once back', async (_what, names, steps) => {
  const { orders, lost, stale } = await everyOrder(names, steps)

  expect(orders).toBeGreaterThan(steps.length)
  expect({ lost: lost.slice(0, 1), stale: stale.slice(0, 1) }).toEqual({ lost: [], stale: [] })
}, 120_000)
