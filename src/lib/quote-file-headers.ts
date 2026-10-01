/**
 * Headers for serving a quote's original file to its owner.
 *
 * `sandbox` stops a crafted image from running script on this origin. PDFs don't get it: Chrome's built-in PDF viewer
 * refuses to render inside a sandboxed document, and a PDF's scripts run in the viewer, not on this origin. Every type
 * keeps nosniff (the type was confirmed from the file's first bytes at upload) and private no-store, and the route
 * serves the file only to its owner.
 */
export function quoteFileHeaders(mime: string, name: string): Record<string, string> {
  return {
    'Content-Type': mime,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(mime.startsWith('image/') ? { 'Content-Security-Policy': 'sandbox' } : {}),
  }
}
