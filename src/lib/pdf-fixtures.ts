/** Test support for the spec sheet PDF, shared by the unit tests and e2e. */
import { crc32, deflateSync } from 'node:zlib'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib'

/** What a spec sheet PDF says about itself: its properties, its language, and the words printed on each page. */
export interface SheetPdf { title: string | undefined; subject: string | undefined; lang: string | undefined; pages: string[] }

const latin1 = new TextDecoder('latin1')

/**
 * Reads the file as a PDF reader would show it. The sheet is an image, so the only page text is what jsPDF writes as
 * `(…) Tj` strings: uncompressed, in WinAnsi for its standard font, which Latin-1 decodes for these words. Each page's
 * strings are unescaped and joined with a space.
 */
export async function readSheetPdf(bytes: Uint8Array): Promise<SheetPdf> {
  const pdf = await PDFDocument.load(bytes)
  const pages = pdf.getPages().map((page) => {
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents]
    const source = streams.map((s) => (s instanceof PDFRawStream ? latin1.decode(s.getContents()) : '')).join('\n')
    return Array.from(source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g), (m) => m[1].replace(/\\(.)/g, '$1')).join(' ')
  })
  const lang = pdf.catalog.lookupMaybe(PDFName.of('Lang'), PDFString)?.decodeText()
  return { title: pdf.getTitle(), subject: pdf.getSubject(), lang, pages }
}

/** A white 1 × 1 PNG, for a PDF test where the sheet's picture does not matter, only the words beside it. */
export function whitePixel(): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([head, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header.set([8, 2], 8) // 8-bit RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}
