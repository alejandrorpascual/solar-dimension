import { expect, test } from 'vitest'
import { PublicError, serverErrorRef, unexpectedServerError } from './server-error'

test('reads the reference of an unexpected server error', () => {
  expect(serverErrorRef(unexpectedServerError('abcd1234'))).toBe('abcd1234')
})

test('reads it after the error crossed to the browser, where only its message is left', () => {
  const arrived = new Error(unexpectedServerError('abcd1234').message)

  expect(serverErrorRef(arrived)).toBe('abcd1234')
})

test.each([
  ['an error of the page\'s own', new TypeError("undefined is not an object (evaluating 'a.b')")],
  ['an error written for the caller', new PublicError('Not found')],
  ['a message that only looks like one', new Error('Server error (ref abcd1234) and more')],
  ['a reference that is not eight hex digits', new Error('Server error (ref select-1)')],
  ['something that is not an Error', 'Server error (ref abcd1234)'],
  ['nothing', null],
])('gives no reference for %s', (_what, error) => {
  expect(serverErrorRef(error)).toBeNull()
})

test('an error written for the caller is an Error with that message', () => {
  const refusal = new PublicError('Not found')

  expect(refusal).toBeInstanceOf(Error)
  expect(refusal.message).toBe('Not found')
})
