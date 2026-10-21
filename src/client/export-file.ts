/**
 * Turning the export sheet into files, in the browser only. The two libraries are imported on demand, so they are
 * fetched the first time someone downloads, not with the page.
 */
import type { jsPDF } from 'jspdf'
import { tr, type Dictionary, type Locale } from '../i18n'
import { pageSlices, type PageSlice, type SheetBlock } from '../lib/pdf-pages'

const PIXEL_RATIO = 2
const SHEET_BACKGROUND = '#FFFFFF'
const A4_PT = { w: 595.28, h: 841.89 }
const PAGE_IMAGE_ALIAS = 'kit-sheet'
/** A capture still running after this is given up on: a stalled phone would otherwise say "Preparing the file…" for good. */
const CAPTURE_TIMEOUT_MS = 30_000
/** How long a download link stays valid after its click. iPhone Safari reads the file some time after the handler returns. */
const REVOKE_AFTER_MS = 40_000

/**
 * The node is the preview, shown scaled down with a CSS transform. Its layout size is unscaled, so capturing at that
 * size with the transform removed gives the full-size sheet.
 */
const imageOptions = (node: HTMLElement) => ({
  pixelRatio: PIXEL_RATIO, backgroundColor: SHEET_BACKGROUND, cacheBust: true,
  width: node.offsetWidth, height: node.offsetHeight, style: { transform: 'none', margin: '0' },
})

/** The web fonts as embeddable CSS, kept once read. */
let fontCss = ''

/**
 * html-to-image reads the page's stylesheets for the web fonts on every capture, and for the cross-origin font sheet it
 * fetches the CSS and inserts its rules into the page again each time. So the fonts are read once and every later
 * capture is handed that CSS. A read that found nothing (the font sheet failed to load) is tried again next time.
 */
async function captureOptions(node: HTMLElement) {
  const { getFontEmbedCSS } = await import('html-to-image')
  fontCss ||= await getFontEmbedCSS(node, imageOptions(node))
  return { ...imageOptions(node), fontEmbedCSS: fontCss }
}

async function toPngDataUrl(node: HTMLElement): Promise<string> {
  const { toPng } = await import('html-to-image')
  return toPng(node, await captureOptions(node))
}

export async function renderPng(node: HTMLElement): Promise<Blob> {
  const { toBlob } = await import('html-to-image')
  const blob = await toBlob(node, await captureOptions(node))
  if (!blob) throw new Error('The kit image came out empty')
  return blob
}

/** Every `data-pdf-block` in sheet pixels. The node is shown scaled in the preview, so rects are divided by that scale. */
function sheetBlocks(node: HTMLElement): SheetBlock[] {
  const box = node.getBoundingClientRect()
  const scale = box.width / node.offsetWidth || 1
  return Array.from(node.querySelectorAll<HTMLElement>('[data-pdf-block]')).map((el) => {
    const r = el.getBoundingClientRect()
    return {
      top: (r.top - box.top) / scale,
      bottom: (r.bottom - box.top) / scale,
      keepWithNext: el.dataset.pdfBlock === 'keep',
      breakBefore: el.dataset.pdfBreak !== undefined,
    }
  })
}

/** The sheet's own top padding (.ksheet), repeated on every page after the first so none starts at the paper's edge. */
const CONTINUATION_TOP_PX = 56

/** One printed page: the slice of the sheet it shows, and how far down the page that slice is drawn (sheet pixels). */
export interface PrintPage extends PageSlice { top: number }

/** How the PDF cuts the sheet into A4 pages, and the page height in sheet pixels. The preview draws the same pages. */
export function printPages(node: HTMLElement): { pages: PrintPage[]; pageHeight: number } {
  const pageHeight = (node.offsetWidth * A4_PT.h) / A4_PT.w
  const slices = pageSlices(sheetBlocks(node), node.offsetHeight, pageHeight, CONTINUATION_TOP_PX)
  return { pages: slices.map((slice, i) => ({ ...slice, top: i === 0 ? 0 : CONTINUATION_TOP_PX })), pageHeight }
}

/** The words a PDF carries beside the sheet's picture: the same project name, date and language the sheet shows. */
export interface SheetMeta { projectName: string; date: string; t: Dictionary; locale: Locale }

/** The captured sheet: a PNG data URL and the sheet's size in CSS pixels. */
export interface SheetImage { dataUrl: string; width: number; height: number }

/** The sheet as A4 pages. The image is captured while jsPDF loads. */
export async function renderPdf(node: HTMLElement, meta: SheetMeta): Promise<Blob> {
  const [dataUrl] = await Promise.all([toPngDataUrl(node), import('jspdf')])
  return sheetPdf({ dataUrl, width: node.offsetWidth, height: node.offsetHeight }, printPages(node).pages, meta)
}

/**
 * The PDF of a captured sheet. The image is scaled to the page width; each page shows one slice of it, ending before
 * any row that would be cut, and white bands hide whatever of the neighbouring slices would peek in above or below it.
 * One alias stores the image once however many pages there are. The document is titled after the project and tagged
 * with the UI language.
 */
export async function sheetPdf(image: SheetImage, pages: readonly PrintPage[], meta: SheetMeta): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  doc.setProperties({ title: meta.projectName, subject: meta.t.ui.sheetTitle })
  doc.setLanguage(meta.locale)
  const ptPerPx = A4_PT.w / image.width
  pages.forEach((page, i) => {
    if (i > 0) doc.addPage()
    const top = page.top * ptPerPx
    doc.addImage(image.dataUrl, 'PNG', 0, top - page.start * ptPerPx, A4_PT.w, image.height * ptPerPx, PAGE_IMAGE_ALIAS, 'FAST')
    doc.setFillColor(SHEET_BACKGROUND)
    if (top > 0) doc.rect(0, 0, A4_PT.w, top, 'F')
    const shownEnd = top + (page.end - page.start) * ptPerPx
    if (shownEnd < A4_PT.h) doc.rect(0, shownEnd, A4_PT.w, A4_PT.h - shownEnd, 'F')
    drawRunningLine(doc, meta, { page: i + 1, pages: pages.length }, ptPerPx)
  })
  return doc.output('blob')
}

/** The sheet's side padding (.ksheet): the running line starts and ends where the content does. */
const SHEET_SIDE_PX = 60
/**
 * The line at the top of every page. It sits in the margin each page already leaves blank (the sheet's own top padding
 * on page one, CONTINUATION_TOP_PX after it), so no page break moves. Sized and coloured like the sheet's kicker.
 */
const RUNNING_LINE = { fontPt: 7.5, baselinePx: 30, gapPx: 16, color: '#5C6470' }

/** Everything jsPDF's standard font cannot print: WinAnsi is Latin-1 plus a few typographic marks. */
const NOT_WIN_ANSI = /[^\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/gu

/**
 * The text with those characters taken out. One of them anywhere makes jsPDF write the whole string as UTF-16, which
 * the font prints as noise. ponytail: a name in another script keeps only its Latin part on this line (the sheet image
 * and the document title keep all of it); embedding a Unicode font is the fix if that ever matters.
 */
const printable = (text: string) => text.normalize('NFC').replace(NOT_WIN_ANSI, ' ').replace(/\s+/g, ' ').trim()

/** "Garita · 19 Oct 2026" on the left, "Estimate · Page 1 of 2" on the right, in the UI language. */
function drawRunningLine(doc: jsPDF, meta: SheetMeta, at: { page: number; pages: number }, ptPerPx: number): void {
  const left = printable(`${meta.projectName} · ${meta.date}`)
  const right = printable(`${meta.t.ui.sheetEstimate} · ${tr(meta.t, 'previewPage', at)}`)
  const start = SHEET_SIDE_PX * ptPerPx
  const end = A4_PT.w - start
  const baseline = RUNNING_LINE.baselinePx * ptPerPx
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(RUNNING_LINE.fontPt)
  doc.setTextColor(RUNNING_LINE.color)
  // ponytail: a long name wraps to a second line inside the margin rather than run under the page number.
  doc.text(left, start, baseline, { maxWidth: end - start - doc.getTextWidth(right) - RUNNING_LINE.gapPx * ptPerPx })
  doc.text(right, end, baseline, { align: 'right' })
}

/**
 * The capture's file, or a rejection once the time is up. The capture libraries cannot be cancelled, so a file that
 * arrives after the limit is dropped, never saved.
 */
export function withinCaptureLimit<T>(capture: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The kit file was not ready after ${CAPTURE_TIMEOUT_MS / 1000} s`)), CAPTURE_TIMEOUT_MS)
  })
  return Promise.race([capture, expired]).finally(() => clearTimeout(timer))
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  // Not at once: iPhone Safari starts the download after the click handler returns, and a revoked link saves nothing.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
}

/** Whether this browser can hand a file to the system share sheet (most phones; few desktops). */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof File === 'undefined') return false
  try {
    return navigator.canShare({ files: [new File([''], 'kit.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

/** Opens the share sheet with the file. Closing the sheet without sharing is not an error. */
export async function shareFile(file: File, title: string): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: [file], title })
    return 'shared'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    throw err
  }
}
