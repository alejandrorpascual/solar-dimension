import { expect, test } from '@playwright/test'

/**
 * pdf-lib counts an uploaded PDF's pages on the server. Its error messages name `PDFDocument`, so any script that
 * carries the library carries that word, even minified.
 */
const PDF_LIB_MARKER = 'PDFDocument'

test('/?step=1: no script the first page loads carries the server-only PDF library', async ({ page }) => {
  const scripts: Promise<{ url: string; body: string }>[] = []
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return
    scripts.push(response.text().then((body) => ({ url: response.url(), body })))
  })

  await page.goto('/?step=1', { waitUntil: 'networkidle' })

  const loaded = await Promise.all(scripts)
  expect(loaded.length, 'scripts loaded on /?step=1').toBeGreaterThan(0)
  const withPdfLib = loaded.filter(({ body }) => body.includes(PDF_LIB_MARKER)).map(({ url }) => url)
  expect(withPdfLib, 'scripts that carry pdf-lib').toEqual([])
})
