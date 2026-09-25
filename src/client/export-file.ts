/**
 * Turning the export sheet into files, in the browser only. The two libraries are imported on demand, so they are
 * fetched the first time someone downloads, not with the page.
 */
import { pageSlices, type SheetBlock } from '../lib/pdf-pages'

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
    return { top: (r.top - box.top) / scale, bottom: (r.bottom - box.top) / scale, keepWithNext: el.dataset.pdfBlock === 'keep' }
  })
}

/**
 * The sheet as A4 pages. The image is scaled to the page width; each page shows one slice of it, ending before any
 * row that would be cut, and a white band hides whatever of the next slice would peek in under it. One alias stores
 * the image once however many pages there are.
 */
export async function renderPdf(node: HTMLElement): Promise<Blob> {
  const [dataUrl, { jsPDF }] = await Promise.all([toPngDataUrl(node), import('jspdf')])
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const ptPerPx = A4_PT.w / node.offsetWidth
  const slices = pageSlices(sheetBlocks(node), node.offsetHeight, A4_PT.h / ptPerPx)
  slices.forEach((slice, i) => {
    if (i > 0) doc.addPage()
    doc.addImage(dataUrl, 'PNG', 0, -slice.start * ptPerPx, A4_PT.w, node.offsetHeight * ptPerPx, PAGE_IMAGE_ALIAS, 'FAST')
    const shown = (slice.end - slice.start) * ptPerPx
    if (shown < A4_PT.h) {
      doc.setFillColor(SHEET_BACKGROUND)
      doc.rect(0, shown, A4_PT.w, A4_PT.h - shown, 'F')
    }
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
