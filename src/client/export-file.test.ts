import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getDictionary, type Locale } from '../i18n'
import { readSheetPdf, whitePixel } from '../lib/pdf-fixtures'
import { saveBlob, sheetPdf, withinCaptureLimit, type PrintPage } from './export-file'

/** html-to-image needs a browser; these stand-ins record what each capture is asked to embed. */
const capture = vi.hoisted(() => ({
  getFontEmbedCSS: vi.fn(async () => '@font-face { font-family: Figtree; }'),
  toBlob: vi.fn(async () => new Blob(['png'])),
  toPng: vi.fn(async () => 'data:image/png;base64,'),
}))
vi.mock('html-to-image', () => capture)

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

/** A two-page sheet: the second page is drawn 56 px down, under the continuation margin. */
const SHEET = { dataUrl: whitePixel(), width: 794, height: 2000 }
const TWO_PAGES: PrintPage[] = [{ start: 0, end: 1100, top: 0 }, { start: 1100, end: 2000, top: 56 }]

const meta = (locale: Locale, projectName = 'Garita') => ({ projectName, date: '19 Oct 2026', t: getDictionary(locale), locale })

async function read(blob: Promise<Blob>) {
  return readSheetPdf(new Uint8Array(await (await blob).arrayBuffer()))
}

describe('sheetPdf', () => {
  test.each(['en', 'es'] as const)('names the document after the project, in the UI language (%s)', async (locale) => {
    const pdf = await read(sheetPdf(SHEET, TWO_PAGES, meta(locale)))
    expect(pdf.title).toBe('Garita')
    expect(pdf.subject).toBe(getDictionary(locale).ui.sheetTitle)
    expect(pdf.lang).toBe(locale)
    expect(pdf.pages).toHaveLength(2)
  })

  test('prints the project, the date, the page and the estimate word at the top of every page', async () => {
    expect((await read(sheetPdf(SHEET, TWO_PAGES, meta('en')))).pages).toEqual([
      'Garita · 19 Oct 2026 Estimate · Page 1 of 2',
      'Garita · 19 Oct 2026 Estimate · Page 2 of 2',
    ])
  })

  test('says it in Spanish when the UI is in Spanish', async () => {
    expect((await read(sheetPdf(SHEET, TWO_PAGES, { ...meta('es'), date: '19 oct 2026' }))).pages).toEqual([
      'Garita · 19 oct 2026 Estimación · Página 1 de 2',
      'Garita · 19 oct 2026 Estimación · Página 2 de 2',
    ])
  })

  test('leaves out of the line what its font cannot print, and keeps the full name as the title', async () => {
    const pdf = await read(sheetPdf(SHEET, TWO_PAGES.slice(0, 1), meta('en', 'Casa 🏠 – Ñandú')))
    expect(pdf.title).toBe('Casa 🏠 – Ñandú')
    expect(pdf.pages).toEqual(['Casa – Ñandú · 19 Oct 2026 Estimate · Page 1 of 1'])
  })
})

describe('captures', () => {
  const FONT_CSS = '@font-face { font-family: Figtree; }'
  const node = { offsetWidth: 794, offsetHeight: 1123 } as unknown as HTMLElement
  // Each test gets a page that has not captured anything yet.
  const freshModule = async () => {
    vi.resetModules()
    return import('./export-file')
  }
  beforeEach(() => { vi.clearAllMocks() })

  test('read the web fonts once for any number of captures, and embed the same fonts in each', async () => {
    const { renderPng } = await freshModule()
    for (let i = 0; i < 10; i++) await renderPng(node)
    expect(capture.getFontEmbedCSS).toHaveBeenCalledOnce()
    expect(capture.toBlob).toHaveBeenCalledTimes(10)
    for (const [, options] of capture.toBlob.mock.calls as unknown as [HTMLElement, { fontEmbedCSS?: string }][]) {
      expect(options.fontEmbedCSS).toBe(FONT_CSS)
    }
  })

  test('read the fonts again on the next capture when the first read found none', async () => {
    const { renderPng } = await freshModule()
    capture.getFontEmbedCSS.mockResolvedValueOnce('')
    await renderPng(node)
    await renderPng(node)
    await renderPng(node)
    expect(capture.getFontEmbedCSS).toHaveBeenCalledTimes(2)
    expect(capture.toBlob).toHaveBeenLastCalledWith(node, expect.objectContaining({ fontEmbedCSS: FONT_CSS }))
  })
})
