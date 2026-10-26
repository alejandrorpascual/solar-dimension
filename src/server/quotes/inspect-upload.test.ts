import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import { QUOTE_LIMITS } from '../../lib/quote-limits'
import { inspectUpload } from './inspect-upload'

const pdf = async (pages: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage()
  return new Uint8Array(await doc.save())
}

describe('inspectUpload', () => {
  test('a real PDF within the page limit is accepted with its page count', async () => {
    expect(await inspectUpload(await pdf(3))).toEqual({ ok: true, mime: 'application/pdf', pages: 3 })
  })
  test('a PDF over the page limit is refused with its page count', async () => {
    const pages = QUOTE_LIMITS.maxPages + 1
    expect(await inspectUpload(await pdf(pages))).toEqual({ ok: false, rejection: { code: 'pages', pages } })
  })
  test('a photo is accepted without a page count', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    expect(await inspectUpload(png)).toEqual({ ok: true, mime: 'image/png', pages: null })
  })
  test('a password-protected PDF is refused as encrypted, not as the wrong type', async () => {
    const locked = new Uint8Array(readFileSync(new URL('../../lib/fixtures/password-protected.pdf', import.meta.url)))
    expect(await inspectUpload(locked)).toEqual({ ok: false, rejection: { code: 'encrypted' } })
  })
  test('bytes of another type, or a broken PDF, are refused as the wrong type', async () => {
    const text = (s: string) => new TextEncoder().encode(s)
    expect(await inspectUpload(text('<html></html>'))).toEqual({ ok: false, rejection: { code: 'type' } })
    expect(await inspectUpload(text('%PDF-1.4 this is not a real pdf'))).toEqual({ ok: false, rejection: { code: 'type' } })
  })
})
