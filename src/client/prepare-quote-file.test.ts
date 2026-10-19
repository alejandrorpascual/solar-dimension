import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prepareQuoteFile } from './prepare-quote-file'

/** A large photo, so it is always shrunk. */
const BIG_EDGE = 4000
/** Under the 2048 px edge the shrink keeps. */
const SMALL_EDGE = 800
const photo = () => new File([new Uint8Array(16)], 'quote.png', { type: 'image/png' })

/** A few bytes of a phone JPEG: the start marker, then an EXIF block holding a GPS position. */
const smallPhotoWithExif = () =>
  new File([Uint8Array.of(0xff, 0xd8, 0xff, 0xe1), 'Exif\0\0GPSLatitude 10.4806 N'], 'quote.jpg', { type: 'image/jpeg' })
const hasExif = async (file: File) => Buffer.from(await file.arrayBuffer()).includes('Exif')

/** A fake browser whose 2D context records what is painted, in order. */
function stubBrowser(opts: { hasContext?: boolean; drawThrows?: boolean; edge?: number } = {}) {
  const calls: string[] = []
  const edge = opts.edge ?? BIG_EDGE
  const bitmap = { width: edge, height: edge / 2, close: vi.fn(() => { calls.push('close') }) }
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
  test('a small photo is redrawn too, so its EXIF metadata, GPS position included, is not uploaded', async () => {
    stubBrowser({ edge: SMALL_EDGE })
    const file = smallPhotoWithExif()
    expect(await hasExif(file)).toBe(true)
    const out = await prepareQuoteFile(file)
    expect(await hasExif(out)).toBe(false)
    expect(out.type).toBe('image/jpeg')
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
