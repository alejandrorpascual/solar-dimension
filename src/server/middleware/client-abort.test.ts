import { HTTPError } from 'nitro/h3'
import { describe, expect, test } from 'vitest'
import clientAbort, { CLIENT_CLOSED_REQUEST, answerWhenClientGone, isClientAbort } from './client-abort'

const abortError = () => new DOMException('This operation was aborted', 'AbortError')

function requestWithSignal() {
  const controller = new AbortController()
  const request = new Request('http://localhost/_serverFn/x', { signal: controller.signal })
  return { controller, request }
}

const eventFor = (request: Request) => ({ req: request }) as unknown as Parameters<typeof clientAbort>[0]

describe('answerWhenClientGone', () => {
  test('replaces the request signal with one that stays quiet until the client leaves', () => {
    // Arrange
    const { controller, request } = requestWithSignal()
    const original = request.signal

    // Act
    answerWhenClientGone(request)

    // Assert
    expect(request.signal).not.toBe(original)
    expect(request.signal.aborted).toBe(false)
    expect(controller.signal.aborted).toBe(false)
  })

  test('relays a client disconnect as a 499 HTTPError reason so h3 treats it as handled', () => {
    // Arrange
    const { controller, request } = requestWithSignal()
    answerWhenClientGone(request)

    // Act
    controller.abort()

    // Assert
    const reason: unknown = request.signal.reason
    expect(request.signal.aborted).toBe(true)
    expect(HTTPError.isError(reason)).toBe(true)
    expect((reason as HTTPError).status).toBe(CLIENT_CLOSED_REQUEST)
    expect((reason as HTTPError).unhandled).toBeFalsy()
  })

  test('aborts immediately when the client was already gone', () => {
    // Arrange
    const { controller, request } = requestWithSignal()
    controller.abort()

    // Act
    answerWhenClientGone(request)

    // Assert
    expect(request.signal.aborted).toBe(true)
    expect((request.signal.reason as HTTPError).status).toBe(CLIENT_CLOSED_REQUEST)
  })
})

describe('isClientAbort', () => {
  test('recognises a bare DOMException named AbortError', () => {
    expect(isClientAbort(abortError())).toBe(true)
  })

  test('recognises an abort wrapped in another error through the cause chain', () => {
    const wrapped = new TypeError('fetch failed', { cause: abortError() })
    expect(isClientAbort(wrapped)).toBe(true)
  })

  test('recognises the relayed 499 reason', () => {
    const { controller, request } = requestWithSignal()
    answerWhenClientGone(request)
    controller.abort()
    expect(isClientAbort(request.signal.reason)).toBe(true)
  })

  test('rejects genuine errors and non-error values', () => {
    expect(isClientAbort(new Error('Unauthorized'))).toBe(false)
    expect(isClientAbort(new HTTPError({ status: 500 }))).toBe(false)
    expect(isClientAbort(new DOMException('timed out', 'TimeoutError'))).toBe(false)
    expect(isClientAbort('AbortError')).toBe(false)
    expect(isClientAbort(null)).toBe(false)
  })

  test('stops walking a self-referential cause chain', () => {
    const loop = new Error('loop')
    loop.cause = loop
    expect(isClientAbort(loop)).toBe(false)
  })
})

describe('clientAbort middleware', () => {
  test('relays the signal before running the route and passes its result through', async () => {
    // Arrange
    const { request } = requestWithSignal()
    const original = request.signal
    const downstream = new Response('ok')
    let signalSeenByRoute: AbortSignal | undefined

    // Act
    const result = await clientAbort(eventFor(request), async () => {
      signalSeenByRoute = request.signal
      return downstream
    })

    // Assert
    expect(result).toBe(downstream)
    expect(signalSeenByRoute).toBeDefined()
    expect(signalSeenByRoute).not.toBe(original)
  })

  test('answers an escaped client abort with an empty 499 instead of rethrowing', async () => {
    // Arrange
    const { request } = requestWithSignal()
    const next = async () => {
      throw abortError()
    }

    // Act
    const result = await clientAbort(eventFor(request), next)

    // Assert
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(CLIENT_CLOSED_REQUEST)
    expect((result as Response).body).toBeNull()
  })

  test('rethrows genuine errors unchanged so they are still logged', async () => {
    // Arrange
    const { request } = requestWithSignal()
    const genuine = new Error('Unauthorized')
    const next = async () => {
      throw genuine
    }

    // Act & Assert
    await expect(clientAbort(eventFor(request), next)).rejects.toBe(genuine)
  })
})
