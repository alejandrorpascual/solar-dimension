import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prepareQuoteFile } from './prepare-quote-file'

/** A large photo, so it is always shrunk. */
const BIG_EDGE = 4000
const photo = () => new File([new Uint8Array(16)], 'quote.png', { type: 'image/png' })

/** A fake browser whose 2D context records what is painted, in order. */
function stubBrowser(opts: { hasContext?: boolean; drawThrows?: boolean } = {}) {
  const calls: string[] = []
  const bitmap = { width: BIG_EDGE, height: BIG_EDGE / 2, close: vi.fn(() => { calls.push('close') }) }
  const ctx = opts.hasContext === false ? null : {
    fillStyle: '',
    fillRect() { calls.push(`fill ${this.fillStyle}`) },
    drawImage() {
      calls.push('draw')
      if (opts.drawThrows) throw new Error('draw failed')
    },
  }
  class FakeCanvas {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return ctx }
    async convertToBlob() { return new Blob([new Uint8Array(4)], { type: 'image/jpeg' }) }
  }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  return { bitmap, calls }
}

describe('prepareQuoteFile', () => {
  let errors: ReturnType<typeof vi.spyOn>
  beforeEach(() => { errors = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => {
    vi.unstubAllGlobals()
    errors.mockRestore()
  })

  test('a PDF passes through untouched', async () => {
    const pdf = new File([new Uint8Array(4)], 'q.pdf', { type: 'application/pdf' })
    expect(await prepareQuoteFile(pdf)).toBe(pdf)
  })
  test('a large photo becomes a JPEG on a white background, so a transparent PNG does not turn black', async () => {
    const { calls } = stubBrowser()
    const out = await prepareQuoteFile(photo())
    expect(out.name).toBe('quote.jpg')
    expect(out.type).toBe('image/jpeg')
    expect(calls).toEqual(['fill #fff', 'draw', 'close'])
  })
  test('without a 2D context the original file is sent, not a blank JPEG', async () => {
    const { bitmap } = stubBrowser({ hasContext: false })
    const file = photo()
    expect(await prepareQuoteFile(file)).toBe(file)
    expect(bitmap.close).toHaveBeenCalled()
  })
  test('if drawing throws, the bitmap is still closed and the original file is sent', async () => {
    const { bitmap } = stubBrowser({ drawThrows: true })
    const file = photo()
    expect(await prepareQuoteFile(file)).toBe(file)
    expect(bitmap.close).toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
  })
})
