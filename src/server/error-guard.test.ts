import { notFound, redirect } from '@tanstack/react-router'
import { expect, test, vi } from 'vitest'
import { PublicError, serverErrorRef } from '../lib/server-error'
import { errorForCaller } from './error-guard'

/** What Drizzle throws for a query that failed: the SQL and its parameters in the message, the driver's error as the cause. */
class FailedQueryError extends Error {
  constructor() {
    super('Failed query: select "id", "access_token", "refresh_token" from "account" where "account"."user_id" = $1 limit $2\nparams: user-123,100')
    this.name = 'DrizzleQueryError'
    this.cause = new Error('fetch failed: getaddrinfo ENOTFOUND ep-made-up-12345678.db.invalid')
  }
}

test('a failed query leaves the server as a reference and nothing else, and the query goes to the log', () => {
  const failure = new FailedQueryError()
  const report = vi.fn()

  const sent = errorForCaller(failure, report, () => 'abcd1234')

  expect(sent).toBeInstanceOf(Error)
  expect((sent as Error).message).toBe('Server error (ref abcd1234)')
  expect(JSON.stringify({ sent, message: (sent as Error).message, cause: (sent as Error).cause })).not.toMatch(/select|account|params|user-123|ep-made-up/)
  expect(serverErrorRef(sent)).toBe('abcd1234')
  expect(report).toHaveBeenCalledExactlyOnceWith('abcd1234', failure)
})

test('an error written for the caller reaches them as it is, and is not logged as a failure', () => {
  const refusal = new PublicError('Not found')
  const report = vi.fn()

  const sent = errorForCaller(refusal, report)

  expect(sent).toBe(refusal)
  expect(report).not.toHaveBeenCalled()
})

test('a redirect and a not-found are the router\'s own and pass untouched', () => {
  const toLogin = redirect({ to: '/login' })
  const missing = notFound()
  const report = vi.fn()

  expect(errorForCaller(toLogin, report)).toBe(toLogin)
  expect(errorForCaller(missing, report)).toBe(missing)
  expect(report).not.toHaveBeenCalled()
})

// The last row is the function alone. In the app a falsy throw is never handed to it: the framework takes the call for
// one that succeeded (src/start.ts).
test.each([
  ['a plain Error from our own code that was not marked for the caller', new Error('BLOB_READ_WRITE_TOKEN is not set.')],
  ['something thrown that is not an Error', 'select * from secrets'],
  ['nothing at all, once it is handed over', undefined],
])('%s is replaced too: only what is marked gets out', (_what, thrown) => {
  const report = vi.fn()

  const sent = errorForCaller(thrown, report, () => '0f0f0f0f')

  expect((sent as Error).message).toBe('Server error (ref 0f0f0f0f)')
  expect(report).toHaveBeenCalledExactlyOnceWith('0f0f0f0f', thrown)
})

test('each failure gets a reference of its own, eight hex digits', () => {
  const report = vi.fn()

  const first = serverErrorRef(errorForCaller(new FailedQueryError(), report))
  const second = serverErrorRef(errorForCaller(new FailedQueryError(), report))

  expect(first).toMatch(/^[0-9a-f]{8}$/)
  expect(second).toMatch(/^[0-9a-f]{8}$/)
  expect(first).not.toBe(second)
})
