import { describe, expect, test } from 'vitest'
import { quoteFileHeaders } from './quote-file-headers'

describe('quoteFileHeaders', () => {
  test('a photo is sandboxed, never sniffed and never cached', () => {
    expect(quoteFileHeaders('image/png', 'recibo.png')).toEqual({
      'Content-Type': 'image/png',
      'Content-Disposition': "inline; filename*=UTF-8''recibo.png",
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    })
  })
  test("a PDF is not sandboxed, so Chrome's PDF viewer can show it, and keeps the other protections", () => {
    const h = quoteFileHeaders('application/pdf', 'Oferta José.pdf')
    expect(h).not.toHaveProperty('Content-Security-Policy')
    expect(h).toMatchObject({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
    expect(h['Content-Disposition']).toBe("inline; filename*=UTF-8''Oferta%20Jos%C3%A9.pdf")
  })
})
