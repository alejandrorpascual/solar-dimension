import { EncryptedPDFError, PDFDocument } from 'pdf-lib'

export type PdfInfo = { ok: true; pages: number } | { ok: false; reason: 'encrypted' | 'invalid' }

/** Page count for the 10-page limit. A password-protected or broken PDF can't be read by the model either. */
export async function pdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const pages = doc.getPageCount()
    // pdf-lib's parser is lenient: a damaged file can load with no pages rather than throw.
    return pages > 0 ? { ok: true, pages } : { ok: false, reason: 'invalid' }
  } catch (error) {
    return { ok: false, reason: error instanceof EncryptedPDFError ? 'encrypted' : 'invalid' }
  }
}
