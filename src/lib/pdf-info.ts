import { PDFDocument } from 'pdf-lib'

export type PdfInfo = { ok: true; pages: number } | { ok: false; reason: 'encrypted' | 'invalid' }

/**
 * The trailer, or a cross-reference stream's dictionary, names the encryption dictionary: "/Encrypt 12 0 R", or the
 * dictionary itself. A name that only starts with it, like /EncryptMetadata, is not the entry.
 */
const ENCRYPT_ENTRY = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/
const latin1 = new TextDecoder('latin1')

/** Page count for the page limit. A password-protected or broken PDF can't be read by the model either. */
export async function pdfInfo(bytes: Uint8Array): Promise<PdfInfo> {
  try {
    // pdf-lib's own refusal can't be recognised (its ES5 build makes `instanceof EncryptedPDFError` false), so load past it and ask the document.
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
    if (doc.isEncrypted) return { ok: false, reason: 'encrypted' }
    const pages = doc.getPageCount()
    // pdf-lib's parser is lenient: a damaged file can load with no pages rather than throw.
    return pages > 0 ? { ok: true, pages } : { ok: false, reason: 'invalid' }
  } catch {
    // The parser can fail on a protected file before it reaches the check, but the trailer still names the encryption dictionary.
    return { ok: false, reason: ENCRYPT_ENTRY.test(latin1.decode(bytes)) ? 'encrypted' : 'invalid' }
  }
}
