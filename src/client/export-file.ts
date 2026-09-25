/**
 * Turning the export sheet into files, in the browser only. The two libraries are imported on demand, so they are
 * fetched the first time someone downloads, not with the page.
 */

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

/**
 * The sheet as A4 pages: the image is scaled to the page width and, when it is taller than one page, placed again on
 * each extra page shifted up by a page height. One alias stores the image once however many pages there are.
 */
export async function renderPdf(node: HTMLElement): Promise<Blob> {
  const [dataUrl, { jsPDF }] = await Promise.all([toPngDataUrl(node), import('jspdf')])
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const imageH = (node.offsetHeight / node.offsetWidth) * A4_PT.w
  const pages = Math.max(1, Math.ceil(imageH / A4_PT.h - 0.01))
  for (let i = 0; i < pages; i++) {
    if (i > 0) doc.addPage()
    doc.addImage(dataUrl, 'PNG', 0, -i * A4_PT.h, A4_PT.w, imageH, PAGE_IMAGE_ALIAS, 'FAST')
  }
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
