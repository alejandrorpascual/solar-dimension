import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveBlob, withinCaptureLimit } from './export-file'

const BLOB_URL = 'blob:kit-file'

/** A fake page: the anchor `saveBlob` clicks, and the object URL it makes and revokes. */
function stubBrowser() {
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append: vi.fn() } })
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue(BLOB_URL)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { anchor, create, revoke }
}

describe('saveBlob', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('clicks a link to the file under its name', () => {
    const { anchor } = stubBrowser()
    saveBlob(new Blob(['x']), 'Home-kit.pdf')
    expect(anchor.href).toBe(BLOB_URL)
    expect(anchor.download).toBe('Home-kit.pdf')
    expect(anchor.click).toHaveBeenCalledOnce()
  })

  test('keeps the link alive for 40 s after the click, for a phone that starts the download late', () => {
    const { revoke } = stubBrowser()
    saveBlob(new Blob(['x']), 'Home-kit.pdf')
    vi.advanceTimersByTime(0)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(39_999)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoke).toHaveBeenCalledExactlyOnceWith(BLOB_URL)
  })
})

describe('withinCaptureLimit', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('passes the file through when the capture finishes in time', async () => {
    const file = new Blob(['x'])
    await expect(withinCaptureLimit(Promise.resolve(file))).resolves.toBe(file)
  })

  test('passes the capture\'s own error through', async () => {
    await expect(withinCaptureLimit(Promise.reject(new Error('The kit image came out empty')))).rejects.toThrow('The kit image came out empty')
  })

  test('gives up on a capture still running after 30 s', async () => {
    const outcome = vi.fn()
    withinCaptureLimit(new Promise<Blob>(() => {})).then(() => outcome('file'), () => outcome('failed'))
    await vi.advanceTimersByTimeAsync(29_999)
    expect(outcome).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(outcome).toHaveBeenCalledExactlyOnceWith('failed')
  })

  test('drops a file that arrives after the limit', async () => {
    let finish!: (file: Blob) => void
    const outcome = vi.fn()
    withinCaptureLimit(new Promise<Blob>((resolve) => { finish = resolve })).then(() => outcome('file'), () => outcome('failed'))
    await vi.advanceTimersByTimeAsync(30_000)
    finish(new Blob(['too late']))
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toHaveBeenCalledExactlyOnceWith('failed')
  })

  test('leaves no timer running once the capture is done', async () => {
    await withinCaptureLimit(Promise.resolve(new Blob(['x'])))
    expect(vi.getTimerCount()).toBe(0)
  })
})
