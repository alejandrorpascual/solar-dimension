import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from 'vitest'
import { pdfInfo } from './pdf-info'

/**
 * A real PDF saved with an owner and a user password (Ghostscript, 128-bit RC4, object and cross-reference streams).
 * Its trailer carries an /Encrypt entry that points at the encryption dictionary.
 */
const protectedPdf = (): Uint8Array => new Uint8Array(readFileSync(new URL('./fixtures/password-protected.pdf', import.meta.url)))
const text = (s: string): Uint8Array => new TextEncoder().encode(s)

test('counts the pages of a PDF', async () => {
  const doc = await PDFDocument.create()
  doc.addPage(); doc.addPage(); doc.addPage()
  expect(await pdfInfo(await doc.save())).toEqual({ ok: true, pages: 3 })
})

test('reports bytes that are not a PDF as invalid', async () => {
  expect(await pdfInfo(text('hello, not a pdf'))).toEqual({ ok: false, reason: 'invalid' })
})

test('reports a password-protected PDF as encrypted, not invalid', async () => {
  expect(await pdfInfo(protectedPdf())).toEqual({ ok: false, reason: 'encrypted' })
})

test('reports a password-protected PDF as encrypted even when pdf-lib cannot parse it', async () => {
  // Breaking every object's closing keyword makes pdf-lib fail to parse the file; the trailer still names the encryption dictionary.
  const broken = new Uint8Array(Buffer.from(Buffer.from(protectedPdf()).toString('latin1').replaceAll('endobj', 'endxxx'), 'latin1'))
  await expect(PDFDocument.load(broken, { ignoreEncryption: true })).rejects.toThrow()
  expect(await pdfInfo(broken)).toEqual({ ok: false, reason: 'encrypted' })
})

test('does not call a broken PDF encrypted for a name that only starts with /Encrypt', async () => {
  expect(await pdfInfo(text('%PDF-1.4\n1 0 obj\n<< /EncryptMetadata false >>\nendobj\n'))).toEqual({ ok: false, reason: 'invalid' })
})
