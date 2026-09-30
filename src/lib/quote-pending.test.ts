import { describe, expect, test } from 'vitest'
import { DEFAULT_MUSTS } from './quote-items'
import {
  addPendingMust, addPendingOverride, NO_PENDING, overlayPending, settlePendingMust, settlePendingOverride, type VerdictEdits,
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
    const pending = addPendingOverride(addPendingMust(NO_PENDING, 'wifi', true, 1), 'q1', 'fuse', 'included', 2)
    const before = structuredClone({ server, pending })
    overlayPending(server, pending)
    expect({ server, pending }).toEqual(before)
    expect(NO_PENDING).toEqual({ musts: {}, overrides: {} })
  })
})

describe('settling a pending edit', () => {
  test('a settled save is no longer laid over the server data', () => {
    const pending = settlePendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'wifi', 1)
    expect(overlayPending(server, pending)).toEqual(server)
    const o = settlePendingOverride(addPendingOverride(NO_PENDING, 'q1', 'fuse', 'included', 2), 'q1', 'fuse', 2)
    expect(overlayPending(server, o)).toEqual(server)
  })

  test('an older save settling keeps a newer edit of the same item that is still in flight', () => {
    const twice = addPendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'wifi', false, 2)
    expect(overlayPending(server, settlePendingMust(twice, 'wifi', 1)).musts.wifi).toBe(false)
    const both = addPendingOverride(addPendingOverride(NO_PENDING, 'q1', 'fuse', 'included', 3), 'q1', 'fuse', 'not_included', 4)
    expect(overlayPending(server, settlePendingOverride(both, 'q1', 'fuse', 3)).overrides.q1).toEqual({ wifi: 'included', fuse: 'not_included' })
  })

  test('settling keeps the other items and quotes in flight', () => {
    const pending = addPendingOverride(addPendingOverride(NO_PENDING, 'q1', 'fuse', 'included', 1), 'q2', 'wifi', 'included', 2)
    const settled = settlePendingOverride(pending, 'q1', 'fuse', 1)
    expect(overlayPending(server, settled).overrides).toEqual({ q1: { wifi: 'included' }, q2: { wifi: 'included' } })
    const musts = settlePendingMust(addPendingMust(addPendingMust(NO_PENDING, 'wifi', true, 1), 'fuse', false, 2), 'wifi', 1)
    expect(overlayPending(server, musts).musts).toEqual({ ...DEFAULT_MUSTS, fuse: false })
  })

  test('settling something that is not pending changes nothing', () => {
    expect(settlePendingMust(NO_PENDING, 'wifi', 1)).toEqual(NO_PENDING)
    expect(settlePendingOverride(NO_PENDING, 'q1', 'wifi', 1)).toEqual(NO_PENDING)
  })
})
