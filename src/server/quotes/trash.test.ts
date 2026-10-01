import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { QuoteStorage } from './storage'
import { emptyTrash, TRASH_BATCH, type TrashRepo } from './trash'

const A = 'quotes/u1/00000000-0000-4000-8000-00000000000a.pdf'
const B = 'quotes/u1/00000000-0000-4000-8000-00000000000b.png'
const C = 'quotes/u2/00000000-0000-4000-8000-00000000000c.jpg'

/** Storage that removes every path except those in `broken`; with `isDown` every call fails. */
function fakeStorage(opts: { broken?: string[]; isDown?: boolean } = {}) {
  const calls: string[][] = []
  const storage: QuoteStorage = {
    put: async () => {},
    get: async () => null,
    async remove(ps) {
      calls.push([...ps])
      if (opts.isDown) throw new Error('blob outage')
      const bad = ps.find((p) => opts.broken?.includes(p))
      if (bad) throw new Error(`cannot remove ${bad}`)
    },
  }
  return { storage, calls }
}

/** The trash table as a list of paths, oldest first. */
function fakeTrash(rows: string[], opts: { isClearBroken?: boolean; isTakeBroken?: boolean } = {}) {
  const state = { rows: [...rows], limits: [] as number[] }
  const trash: TrashRepo = {
    async oldest(limit) {
      state.limits.push(limit)
      if (opts.isTakeBroken) throw new Error('db down')
      return state.rows.slice(0, limit)
    },
    async clear(ps) {
      if (opts.isClearBroken) throw new Error('db down')
      state.rows = state.rows.filter((r) => !ps.includes(r))
    },
  }
  return { trash, state }
}

describe('emptyTrash', () => {
  let errors: ReturnType<typeof vi.spyOn>
  let warns: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    errors.mockRestore()
    warns.mockRestore()
  })

  test('removes the given files in one call and clears their trash rows', async () => {
    const { storage, calls } = fakeStorage()
    const { trash, state } = fakeTrash([A, B, C])
    expect(await emptyTrash({ storage, trash }, [A, B])).toEqual({ removed: [A, B], kept: [] })
    expect(calls).toEqual([[A, B]])
    expect(state.rows).toEqual([C])
    expect(errors).not.toHaveBeenCalled()
  })

  test('with no paths given, takes the oldest rows of the trash, up to one batch', async () => {
    const { storage, calls } = fakeStorage()
    const { trash, state } = fakeTrash([A, B])
    expect(await emptyTrash({ storage, trash })).toEqual({ removed: [A, B], kept: [] })
    expect(state.limits).toEqual([TRASH_BATCH])
    expect(calls).toEqual([[A, B]])
    expect(state.rows).toEqual([])
  })

  test('an empty trash calls no storage', async () => {
    const { storage, calls } = fakeStorage()
    const { trash } = fakeTrash([])
    expect(await emptyTrash({ storage, trash })).toEqual({ removed: [], kept: [] })
    expect(await emptyTrash({ storage, trash }, [])).toEqual({ removed: [], kept: [] })
    expect(calls).toEqual([])
  })

  test('one file that cannot be removed does not hold back the others; it stays in the trash and is logged', async () => {
    const { storage } = fakeStorage({ broken: [B] })
    const { trash, state } = fakeTrash([A, B, C])
    expect(await emptyTrash({ storage, trash }, [A, B, C])).toEqual({ removed: [A, C], kept: [B] })
    expect(state.rows).toEqual([B])
    expect(errors).toHaveBeenCalledWith('[quotes] removing quote files failed; they stay in the trash', {
      failures: [{ path: B, error: expect.any(Error) }],
    })
  })

  test('storage down: nothing is cleared, the failure is logged, and nothing throws', async () => {
    const { storage } = fakeStorage({ isDown: true })
    const { trash, state } = fakeTrash([A, B])
    expect(await emptyTrash({ storage, trash }, [A, B])).toEqual({ removed: [], kept: [A, B] })
    expect(state.rows).toEqual([A, B])
    expect(errors).toHaveBeenCalledTimes(1)
  })

  test('a row that names no stored quote file is cleared without touching storage, and logged', async () => {
    const { storage, calls } = fakeStorage()
    const { trash, state } = fakeTrash(['e2e-seed/1', A])
    expect(await emptyTrash({ storage, trash })).toEqual({ removed: ['e2e-seed/1', A], kept: [] })
    expect(calls).toEqual([[A]])
    expect(state.rows).toEqual([])
    expect(warns).toHaveBeenCalledWith('[quotes] dropped trash rows that name no quote file', { paths: ['e2e-seed/1'] })
  })

  test('a failure to clear the rows is logged, not thrown: the sweep removes those files again later', async () => {
    const { storage } = fakeStorage()
    const { trash, state } = fakeTrash([A], { isClearBroken: true })
    expect(await emptyTrash({ storage, trash }, [A])).toEqual({ removed: [A], kept: [] })
    expect(state.rows).toEqual([A])
    expect(errors).toHaveBeenCalledWith('[quotes] clearing the quote trash failed', { paths: [A], error: expect.any(Error) })
  })

  test('a failure to read the trash is logged, not thrown', async () => {
    const { storage, calls } = fakeStorage()
    const { trash } = fakeTrash([A], { isTakeBroken: true })
    expect(await emptyTrash({ storage, trash })).toEqual({ removed: [], kept: [] })
    expect(calls).toEqual([])
    expect(errors).toHaveBeenCalledWith('[quotes] reading the quote trash failed', { error: expect.any(Error) })
  })
})
