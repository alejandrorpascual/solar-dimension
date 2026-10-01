import { PDFDocument } from 'pdf-lib'
import { expect, test } from 'vitest'
import { pdfInfo } from './pdf-info'

test('counts the pages of a PDF', async () => {
  const doc = await PDFDocument.create()
  doc.addPage(); doc.addPage(); doc.addPage()
  expect(await pdfInfo(await doc.save())).toEqual({ ok: true, pages: 3 })
})

test('reports bytes that are not a PDF as invalid', async () => {
  expect(await pdfInfo(new TextEncoder().encode('hello, not a pdf'))).toEqual({ ok: false, reason: 'invalid' })
})
