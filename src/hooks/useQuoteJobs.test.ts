import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ProjectJobs } from '../lib/quote-jobs'
import { prepareReactInNode, stubContainer } from './react-in-node'
import { QuoteJobsProvider, useProjectQuoteCount, useQuoteJobs } from './useQuoteJobs'

// The project card's delete question counts a project's quotes from these jobs (issue #94). A count of 0 there reads as
// "this project has no quotes", so it must only come from a read of the signed-in account's jobs.

type User = { id: string }
interface Read { account: string; answer: (jobs: ProjectJobs[]) => void; fail: (error: Error) => void }

/** The user the page was loaded for, and the reads of the quote jobs the page sent, which answer when the test says. */
const page = vi.hoisted(() => ({ user: null as User | null, reads: [] as Read[] }))
vi.mock('./useRootData', () => ({ useRootData: () => ({ session: page.user ? { status: 'signed-in', user: page.user } : { status: 'signed-out' }, quotePollMs: 60_000 }) }))
vi.mock('../server/quotes/api', () => ({
  getQuoteJobs: ({ data }: { data: { account: string } }) =>
    new Promise<ProjectJobs[]>((answer, fail) => { page.reads.push({ account: data.account, answer, fail }) }),
  markQuotesSeen: async () => ({ ok: true }),
}))

const ANA = { id: 'user-ana' }
const BEN = { id: 'user-ben' }
const PROJECT_ID = 'p1'

/** `total` finished quotes on the project, none being read, so the page does not poll again. */
const jobsWith = (total: number): ProjectJobs[] => [{
  projectId: PROJECT_ID, projectName: 'Home', files: [], total, done: total, pending: 0, failed: 0, needsReview: 0,
  kitHold: null, unseen: false, best: null,
}]

let root: Root | null = null
let latest: { count: number | null; refresh: () => Promise<void> } | null = null

function Probe(): null {
  latest = { count: useProjectQuoteCount(PROJECT_ID), refresh: useQuoteJobs().refresh }
  return null
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A page load, or the root data changing (a sign-in or sign-out): renders the provider for `page.user`. */
async function render(): Promise<void> {
  root ??= createRoot(stubContainer())
  const mounted = root
  await act(async () => {
    mounted.render(createElement(QuoteJobsProvider, { children: createElement(Probe) }))
    await flush()
  })
}

/** Lands the `index`th read of the jobs. */
async function land(index: number, outcome: { jobs: ProjectJobs[] } | { error: Error }): Promise<void> {
  const read = page.reads[index]
  if (!read) throw new Error(`the page sent no read #${index}`)
  await act(async () => {
    if ('jobs' in outcome) read.answer(outcome.jobs)
    else read.fail(outcome.error)
    await flush()
  })
}

const count = (): number | null => {
  if (!latest) throw new Error('nothing rendered')
  return latest.count
}

beforeEach(() => {
  prepareReactInNode()
  page.user = null
  page.reads = []
  // A failed read is logged by the poller; these tests fail one on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  const mounted = root
  root = null
  latest = null
  if (mounted) await act(async () => { mounted.unmount() })
  vi.restoreAllMocks()
})

test('when the first read of the quotes fails, a project\'s quote count stays unknown, never 0, until a read answers', async () => {
  page.user = ANA
  await render()
  expect(page.reads.map((r) => r.account)).toEqual([ANA.id])
  expect(count()).toBeNull()

  await land(0, { error: new Error('Failed to fetch') })
  expect(count()).toBeNull()

  await act(async () => { void latest?.refresh(); await flush() })
  await land(1, { jobs: jobsWith(2) })
  expect(count()).toBe(2)
})

test('after one account signs out and another signs in, the count is unknown until the new account\'s quotes are read', async () => {
  page.user = ANA
  await render()
  await land(0, { jobs: jobsWith(3) })
  expect(count()).toBe(3)

  page.user = null
  await render()
  page.user = BEN
  await render()
  expect(page.reads.map((r) => r.account)).toEqual([ANA.id, BEN.id])
  expect(count()).toBeNull()

  await land(1, { jobs: jobsWith(1) })
  expect(count()).toBe(1)
})
