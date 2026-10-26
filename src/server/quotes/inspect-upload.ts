import { pdfInfo } from '../../lib/pdf-info'
import { QUOTE_LIMITS, sniffMime, type QuoteMime, type Rejection } from '../../lib/quote-limits'

export type Inspection = { ok: true; mime: QuoteMime; pages: number | null } | { ok: false; rejection: Rejection }

/**
 * What the file really is, from its first bytes, and for a PDF its page count. The browser's checks are only a hint.
 * Server-only: pdf-info loads pdf-lib, so a module the browser imports (quote-guards) must not hold this.
 */
export async function inspectUpload(bytes: Uint8Array): Promise<Inspection> {
  const mime = sniffMime(bytes)
  if (!mime) return { ok: false, rejection: { code: 'type' } }
  if (mime !== 'application/pdf') return { ok: true, mime, pages: null }
  const info = await pdfInfo(bytes)
  if (!info.ok) return { ok: false, rejection: info.reason === 'encrypted' ? { code: 'encrypted' } : { code: 'type' } }
  if (info.pages > QUOTE_LIMITS.maxPages) return { ok: false, rejection: { code: 'pages', pages: info.pages } }
  return { ok: true, mime, pages: info.pages }
}
