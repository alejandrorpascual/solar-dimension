import { afterEach, describe, expect, test, vi } from 'vitest'
import { createQuotePoller, type PollerDeps } from './quote-poller'
import type { ProjectJobs } from './quote-jobs'

/** A promise the test resolves or rejects by hand, to land answers in any order. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const project = (unseen: boolean): ProjectJobs => ({
  projectId: 'p1', projectName: 'Home', files: [], total: 1, done: 1, pending: 0, failed: 0, needsReview: 0,
  kitEmpty: false, unseen, best: null,
})

/** A poller whose loads and marks answer only when the test says so, with the list and the poll outcomes it produced. */
function setup() {
  const loads: ReturnType<typeof deferred<ProjectJobs[]>>[] = []
  const marks: ReturnType<typeof deferred<unknown>>[] = []
  const state = { jobs: [] as ProjectJobs[], outcomes: [] as boolean[] }
  const deps: PollerDeps = {
    load: vi.fn(() => { const d = deferred<ProjectJobs[]>(); loads.push(d); return d.promise }),
    markSeen: vi.fn(() => { const d = deferred<unknown>(); marks.push(d); return d.promise }),
    update: (change) => { state.jobs = change(state.jobs) },
    settle: (ok) => { state.outcomes.push(ok) },
  }
  return { poller: createQuotePoller(deps), deps, loads, marks, state }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const unseen = (jobs: ProjectJobs[]) => jobs.map((j) => j.unseen)

describe('createQuotePoller', () => {
  afterEach(() => { vi.restoreAllMocks() })

  test('a poll shows the jobs and clears the offline state', async () => {
    const { poller, loads, state } = setup()
    poller.setUser('u1')
    const done = poller.refresh()
    loads[0]!.resolve([project(true)])
    await done
    expect(unseen(state.jobs)).toEqual([true])
    expect(state.outcomes).toEqual([true])
  })

  test('a failed poll is logged and counted', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { poller, loads, state } = setup()
    poller.setUser('u1')
    const done = poller.refresh()
    loads[0]!.reject(new Error('offline'))
    await done
    expect(state.outcomes).toEqual([false])
    expect(errors).toHaveBeenCalledWith('[quotes] polling failed', expect.any(Error))
  })

  test('a poll that lands while a verdict is being marked seen does not bring "Verdict ready" back', async () => {
    const { poller, loads, marks, state } = setup()
    poller.setUser('u1')
    const first = poller.refresh()
    loads[0]!.resolve([project(true)])
    await first

    const marking = poller.markSeen('p1')
    expect(unseen(state.jobs)).toEqual([false])
    // A poll starts inside the window and answers with the database as it was before the mark committed.
    const inWindow = poller.refresh()
    loads[1]!.resolve([project(true)])
    await inWindow
    expect(unseen(state.jobs)).toEqual([false])

    marks[0]!.resolve({ ok: true })
    await flush()
    loads[2]!.resolve([project(false)])
    await marking
    expect(unseen(state.jobs)).toEqual([false])
  })

  test('a poll that started inside the window but answers after the mark is dropped', async () => {
    const { poller, loads, marks, state } = setup()
    poller.setUser('u1')
    const marking = poller.markSeen('p1')
    const inWindow = poller.refresh()
    marks[0]!.resolve({ ok: true })
    await flush()
    loads[0]!.resolve([project(true)])
    await inWindow
    expect(state.jobs).toEqual([])
    loads[1]!.resolve([project(false)])
    await marking
    expect(unseen(state.jobs)).toEqual([false])
  })

  test('a mark that fails is logged, and the poll after it shows the truth again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { poller, loads, marks, state } = setup()
    poller.setUser('u1')
    const marking = poller.markSeen('p1')
    marks[0]!.reject(new Error('500'))
    await flush()
    loads[0]!.resolve([project(true)])
    await marking
    expect(errors).toHaveBeenCalledWith('[quotes] marking a verdict as seen failed', expect.objectContaining({ projectId: 'p1' }))
    expect(unseen(state.jobs)).toEqual([true])
  })

  test('signing out while a mark is saving skips the poll after it, so the tray never shows offline', async () => {
    const { poller, deps, marks, state } = setup()
    poller.setUser('u1')
    const marking = poller.markSeen('p1')
    poller.setUser(null)
    marks[0]!.resolve({ ok: true })
    await marking
    expect(deps.load).not.toHaveBeenCalled()
    expect(state.outcomes).toEqual([])
  })

  test('another user signing in while a mark is saving skips the poll after it', async () => {
    const { poller, deps, marks } = setup()
    poller.setUser('u1')
    const marking = poller.markSeen('p1')
    poller.setUser('u2')
    marks[0]!.resolve({ ok: true })
    await marking
    expect(deps.load).not.toHaveBeenCalled()
  })

  test('signed out, nothing is polled or marked', async () => {
    const { poller, deps, state } = setup()
    await poller.refresh()
    poller.setUser('u1')
    poller.setUser(null)
    await poller.refresh()
    await poller.markSeen('p1')
    expect(deps.load).not.toHaveBeenCalled()
    expect(deps.markSeen).not.toHaveBeenCalled()
    expect(state.outcomes).toEqual([])
  })

  test('a poll in flight at sign-out is dropped, even when it fails as unauthorized', async () => {
    const { poller, loads, state } = setup()
    poller.setUser('u1')
    const done = poller.refresh()
    poller.setUser(null)
    loads[0]!.reject(new Error('Unauthorized'))
    await done
    expect(state.outcomes).toEqual([])
  })

  test('setting the same user again keeps the poll in flight', async () => {
    const { poller, loads, state } = setup()
    poller.setUser('u1')
    const done = poller.refresh()
    poller.setUser('u1')
    loads[0]!.resolve([project(true)])
    await done
    expect(unseen(state.jobs)).toEqual([true])
  })
})
