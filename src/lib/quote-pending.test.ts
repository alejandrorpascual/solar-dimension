import { describe, expect, test } from 'vitest'
import { DEFAULT_MUSTS } from './quote-items'
import {
  addPendingMust, addPendingOverride, createClock, NO_PENDING, overlayPending, prunePending, settlePendingMust, settlePendingOverride,
  type VerdictEdits,
} from './quote-pending'

const server: VerdictEdits = {
  musts: DEFAULT_MUSTS,
  overrides: { q1: { wifi: 'included' }, q2: {} },
}

describe('overlayPending', () => {
  test('with nothing in flight, the server data is used as it is', () => {
    expect(overlayPending(server, NO_PENDING)).toEqual(server)
  })

  test('a must-have still saving wins over the server value', () => {
    const pending = addPendingMust(NO_PENDING, 'wifi', true, 1)
    expect(overlayPending(server, pending).musts).toEqual({ ...DEFAULT_MUSTS, wifi: true })
  })

  test('a confirmation still saving wins over the server value, and a cleared one stays cleared', () => {
    const pending = addPendingOverride(addPendingOverride(NO_PENDING, 'q2', 'fuse', 'not_included', 1), 'q1', 'wifi', null, 2)
    expect(overlayPending(server, pending).overrides).toEqual({ q1: {}, q2: { fuse: 'not_included' } })
  })

  test('an edit for a quote the server no longer has is not brought back', () => {
    const pending = addPendingOverride(NO_PENDING, 'gone', 'fuse', 'included', 1)
    expect(overlayPending(server, pending).overrides).toEqual(server.overrides)
  })

  test('the server data and the pending edits are not changed', () => {
    const pending = settlePendingMust(addPendingOverride(addPendingMust(NO_PENDING, 'wifi', true, 1), 'q1', 'fuse', 'included', 2), 'wifi', 1, true, 5)
    const before = structuredClone({ server, pending })
    overlayPending(server, pending)
    prunePending(pending, 10)
    expect({ server, pending }).toEqual(before)
    expect(NO_PENDING).toEqual({ musts: {}, overrides: {} })
  })
})

describe('a settled save and the reloads around it', () => {
  test('a reload requested before the save settled still gets the edit laid over it', () => {
    // Reload requested at 3, save settled at 4: the reload may have read the data before the save landed.
    const settled = settlePendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'wifi', 1, true, 4)
    const kept = prunePending(settled, 3)
    expect(overlayPending(server, kept).musts.wifi).toBe(true)
    const o = settlePendingOverride(addPendingOverride(NO_PENDING, 'q2', 'fuse', 'included', 2), 'q2', 'fuse', 2, 'included', 4)
    expect(overlayPending(server, prunePending(o, 3)).overrides.q2).toEqual({ fuse: 'included' })
  })

  test('a reload requested after the save settled drops the edit: its data has the save', () => {
    const settled = settlePendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'wifi', 1, true, 4)
    expect(prunePending(settled, 5)).toEqual(NO_PENDING)
    const o = settlePendingOverride(addPendingOverride(NO_PENDING, 'q2', 'fuse', 'included', 2), 'q2', 'fuse', 2, 'included', 4)
    expect(prunePending(o, 5)).toEqual(NO_PENDING)
  })

  test('an edit still saving is never dropped by a reload', () => {
    const pending = addPendingOverride(addPendingMust(NO_PENDING, 'wifi', true, 1), 'q1', 'fuse', 'included', 2)
    expect(prunePending(pending, 100)).toBe(pending)
  })

  test('a failed save settles with the value it rolled back to, until a newer reload shows the server', () => {
    const failed = settlePendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'wifi', 1, false, 4)
    expect(overlayPending({ ...server, musts: { ...DEFAULT_MUSTS, wifi: true } }, prunePending(failed, 3)).musts.wifi).toBe(false)
    expect(prunePending(failed, 5)).toEqual(NO_PENDING)
  })

  test('an older save settling leaves a newer edit of the same item alone, and says so', () => {
    const twice = addPendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'wifi', false, 2)
    const settled = settlePendingMust(twice, 'wifi', 1, true, 3)
    expect(settled).toBe(twice)
    expect(overlayPending(server, prunePending(settled, 10)).musts.wifi).toBe(false)
    const both = addPendingOverride(addPendingOverride(NO_PENDING, 'q1', 'fuse', 'included', 3), 'q1', 'fuse', 'not_included', 4)
    expect(settlePendingOverride(both, 'q1', 'fuse', 3, 'included', 5)).toBe(both)
  })

  test('pruning keeps the other items and quotes', () => {
    const pending = settlePendingOverride(
      addPendingOverride(addPendingOverride(NO_PENDING, 'q1', 'fuse', 'included', 1), 'q2', 'wifi', 'included', 2), 'q1', 'fuse', 1, 'included', 3,
    )
    expect(overlayPending(server, prunePending(pending, 4)).overrides).toEqual({ q1: { wifi: 'included' }, q2: { wifi: 'included' } })
    const musts = settlePendingMust(addPendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'fuse', false, 2), 'wifi', 1, true, 3)
    expect(overlayPending(server, prunePending(musts, 4)).musts).toEqual({ ...DEFAULT_MUSTS, fuse: false })
  })

  test('settling something that is not pending changes nothing', () => {
    expect(settlePendingMust(NO_PENDING, 'wifi', 1, true, 2)).toBe(NO_PENDING)
    expect(settlePendingOverride(NO_PENDING, 'q1', 'wifi', 1, null, 2)).toBe(NO_PENDING)
  })
})

describe('createClock', () => {
  test('every tick is later than the one before, so a reload and a settle never tie', () => {
    const clock = createClock()
    const a = clock.tick()
    const b = clock.tick()
    expect(b).toBeGreaterThan(a)
    expect(a).toBeGreaterThan(0)
  })
})
