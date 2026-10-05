/**
 * Turning the export sheet into files, in the browser only. The two libraries are imported on demand, so they are
 * fetched the first time someone downloads, not with the page.
 */
import { pageSlices, type PageSlice, type SheetBlock } from '../lib/pdf-pages'

const PIXEL_RATIO = 2
const SHEET_BACKGROUND = '#FFFFFF'
const A4_PT = { w: 595.28, h: 841.89 }
const PAGE_IMAGE_ALIAS = 'kit-sheet'

/**
 * The node is the preview, shown scaled down with a CSS transform. Its layout size is unscaled, so capturing at that
 * size with the transform removed gives the full-size sheet.
 */
const imageOptions = (node: HTMLElement) => ({
  pixelRatio: PIXEL_RATIO, backgroundColor: SHEET_BACKGROUND, cacheBust: true,
  width: node.offsetWidth, height: node.offsetHeight, style: { transform: 'none', margin: '0' },
})

async function toPngDataUrl(node: HTMLElement): Promise<string> {
  const { toPng } = await import('html-to-image')
  return toPng(node, imageOptions(node))
}

export async function renderPng(node: HTMLElement): Promise<Blob> {
  const { toBlob } = await import('html-to-image')
  const blob = await toBlob(node, imageOptions(node))
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

/**
 * The sheet as A4 pages. The image is scaled to the page width; each page shows one slice of it, ending before any
 * row that would be cut, and white bands hide whatever of the neighbouring slices would peek in above or below it. One
 * alias stores the image once however many pages there are.
 */
export async function renderPdf(node: HTMLElement): Promise<Blob> {
  const [dataUrl, { jsPDF }] = await Promise.all([toPngDataUrl(node), import('jspdf')])
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const ptPerPx = A4_PT.w / node.offsetWidth
  const { pages } = printPages(node)
  pages.forEach((page, i) => {
    if (i > 0) doc.addPage()
    const top = page.top * ptPerPx
    doc.addImage(dataUrl, 'PNG', 0, top - page.start * ptPerPx, A4_PT.w, node.offsetHeight * ptPerPx, PAGE_IMAGE_ALIAS, 'FAST')
    doc.setFillColor(SHEET_BACKGROUND)
    if (top > 0) doc.rect(0, 0, A4_PT.w, top, 'F')
    const shownEnd = top + (page.end - page.start) * ptPerPx
    if (shownEnd < A4_PT.h) doc.rect(0, shownEnd, A4_PT.w, A4_PT.h - shownEnd, 'F')
  })
  return doc.output('blob')
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  // Revoke on the next task: some browsers start the download only after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 0)
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
