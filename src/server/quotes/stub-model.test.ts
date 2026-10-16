import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SAMPLE_QUOTES, SLOW_READ_MARK } from '../../lib/quote-fixtures'
import { DEFAULT_POLL_MS } from '../../lib/quote-jobs'
import { ModelError, type ModelInput } from './model'
import { SLOW_READ_MS, stubModel } from './stub-model'

const file = (fileName: string): ModelInput => ({ bytes: new Uint8Array(), mime: 'application/pdf', fileName })

/** Whether the read has answered, one way or the other, at this point of the fake clock. */
function watch(read: Promise<unknown>): () => boolean {
  let isSettled = false
  read.then(() => { isSettled = true }, () => { isSettled = true })
  return () => isSettled
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('answers with the sample quote named in the file, once the delay it was given has passed', async () => {
  const read = stubModel(200).extract(file('Voltia.pdf'), 'any-model')
  const isSettled = watch(read)

  await vi.advanceTimersByTimeAsync(199)
  expect(isSettled()).toBe(false)
  await vi.advanceTimersByTimeAsync(1)

  await expect(read).resolves.toEqual({ extraction: SAMPLE_QUOTES.voltia, input: 0, output: 0 })
})

test('takes its time over a file marked slow, however short the delay it was given', async () => {
  const read = stubModel(200).extract(file(`voltia-${SLOW_READ_MARK}.pdf`), 'any-model')
  const isSettled = watch(read)

  await vi.advanceTimersByTimeAsync(SLOW_READ_MS - 1)
  expect(isSettled()).toBe(false)
  await vi.advanceTimersByTimeAsync(1)

  await expect(read).resolves.toEqual({ extraction: SAMPLE_QUOTES.voltia, input: 0, output: 0 })
})

test('a slow read is never shorter than the delay every read was given', async () => {
  const read = stubModel(SLOW_READ_MS + 500).extract(file(`voltia-${SLOW_READ_MARK}.pdf`), 'any-model')
  const isSettled = watch(read)

  await vi.advanceTimersByTimeAsync(SLOW_READ_MS + 499)
  expect(isSettled()).toBe(false)
  await vi.advanceTimersByTimeAsync(1)

  expect(isSettled()).toBe(true)
})

test('a slow read outlasts a status poll, so the page gets to show it being read', () => {
  expect(SLOW_READ_MS).toBeGreaterThanOrEqual(DEFAULT_POLL_MS)
})

test('a file that names no sample quote fails as unreadable, after the same wait', async () => {
  const read = stubModel(200).extract(file('unreadable.pdf'), 'any-model')
  const failure = read.catch((error: unknown) => error)

  await vi.advanceTimersByTimeAsync(200)

  const error = await failure
  expect(error).toBeInstanceOf(ModelError)
  expect(error).toMatchObject({ kind: 'invalid' })
})

test('no sample quote is named like the slow mark, so marking a file never changes which quote it is', () => {
  expect(Object.keys(SAMPLE_QUOTES).filter((key) => key.includes(SLOW_READ_MARK) || SLOW_READ_MARK.includes(key))).toEqual([])
})
