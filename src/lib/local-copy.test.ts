import { expect, test } from 'vitest'
import { localCopyPlan } from './local-copy'

const ANA = 'user-ana'
const BEA = 'user-bea'

test('signed out, work done signed out is shown', () => {
  expect(localCopyPlan(null, null, false)).toBe('show')
})

test("on a first sign-in, work done signed out becomes the account's", () => {
  expect(localCopyPlan(ANA, null, false)).toBe('adopt')
})

test("the account's own copy is read over from the account when nothing is unsent", () => {
  expect(localCopyPlan(ANA, ANA, false)).toBe('pull')
})

test("the account's own copy is sent first when something never reached the account", () => {
  expect(localCopyPlan(ANA, ANA, true)).toBe('push')
})

test.each([
  ['with nothing unsent', false],
  ['with unsent edits', true],
])("another account's copy is released %s, never sent", (_what, hasUnsent) => {
  expect(localCopyPlan(BEA, ANA, hasUnsent)).toBe('release')
})

test.each([
  ['with nothing unsent', false],
  ['with unsent edits', true],
])("signed out, an account's copy is released %s: a session that ended is treated as a sign-out", (_what, hasUnsent) => {
  expect(localCopyPlan(null, ANA, hasUnsent)).toBe('release')
})

test('a pending marker left on work done signed out changes nothing', () => {
  expect(localCopyPlan(null, null, true)).toBe('show')
  expect(localCopyPlan(ANA, null, true)).toBe('adopt')
})
