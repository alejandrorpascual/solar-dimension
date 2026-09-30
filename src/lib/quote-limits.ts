const MB = 1024 * 1024

/** 4 MB, not the base spec's 10: a Vercel Function accepts at most a 4.5 MB request body. */
export const QUOTE_LIMITS = { maxBytes: 4 * MB, maxPages: 10, perProject: 10, perMonth: 20 } as const
export const MAX_MB = QUOTE_LIMITS.maxBytes / MB

export const QUOTE_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
export type QuoteMime = (typeof QUOTE_MIMES)[number]
export const EXTENSIONS: Record<QuoteMime, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export type Rejection =
  | { code: 'type' } | { code: 'size'; mb: number } | { code: 'pages'; pages: number } | { code: 'encrypted' }
  | { code: 'project_limit' } | { code: 'month_limit' } | { code: 'not_saved' } | { code: 'upload' }
  /** The account may not start reads: its email is not verified (see canUseQuotes). */
  | { code: 'unverified' }

export const isQuoteMime = (v: string): v is QuoteMime => (QUOTE_MIMES as readonly string[]).includes(v)
export const toMb = (bytes: number): number => Math.round((bytes / MB) * 10) / 10

/** The checks the browser can make before sending anything. The server repeats them. */
export function checkBasics(f: { type: string; size: number }): Rejection | null {
  if (!isQuoteMime(f.type)) return { code: 'type' }
  if (f.size > QUOTE_LIMITS.maxBytes) return { code: 'size', mb: toMb(f.size) }
  return null
}

/** The real type from the first bytes; the browser's `type` is only a hint. */
export function sniffMime(b: Uint8Array): QuoteMime | null {
  const starts = (sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v)
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

export function limitRejection(counts: { project: number; month: number }): Rejection | null {
  if (counts.project >= QUOTE_LIMITS.perProject) return { code: 'project_limit' }
  if (counts.month >= QUOTE_LIMITS.perMonth) return { code: 'month_limit' }
  return null
}

/** The monthly limit counts from the 1st of the month, 00:00 UTC. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

const FILE_NAME_MAX = 120
/** A file name safe to store and show: no folders, no control characters, 120 characters at most. */
export function cleanFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return base.slice(0, FILE_NAME_MAX) || 'quote'
}
