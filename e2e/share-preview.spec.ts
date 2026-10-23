import { expect, test, type APIRequestContext } from '@playwright/test'

const PNG_WIDTH_AT = 16
const PNG_HEIGHT_AT = 20

/** The value of one meta tag in the HTML the server sends, before any script runs: what a chat app reads. */
function metaContent(html: string, key: string): string | null {
  const tag = new RegExp(`<meta[^>]*(?:name|property)="${key}"[^>]*>`).exec(html)?.[0]
  return tag ? (/content="([^"]*)"/.exec(tag)?.[1] ?? null) : null
}

const homeHtml = async (request: APIRequestContext, language: string): Promise<string> => {
  const res = await request.get('/', { headers: { 'Accept-Language': language } })
  expect(res.status()).toBe(200)
  return res.text()
}

test.describe('a link to the app shared in a chat app', () => {
  test('previews with a product description in English and in Spanish, not the help of step 1', async ({ request }) => {
    const en = await homeHtml(request, 'en')
    const es = await homeHtml(request, 'es')
    for (const html of [en, es]) {
      const description = metaContent(html, 'description')
      expect(description).toMatch(/solar/i)
      expect(description).not.toMatch(/watts|vatios/i)
      expect(metaContent(html, 'og:description')).toBe(description)
    }
    expect(metaContent(es, 'description')).not.toBe(metaContent(en, 'description'))
  })

  test('has a title, a large image card and a 1200x630 PNG at the absolute URL it names', async ({ request }) => {
    const html = await homeHtml(request, 'en')
    expect(metaContent(html, 'og:title')).toBe('Solar Dimension')
    expect(metaContent(html, 'twitter:card')).toBe('summary_large_image')
    const image = metaContent(html, 'og:image')
    expect(image).toMatch(/^https?:\/\/[^/]+\/og\.png$/)
    const res = await request.get(image!)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
    const png = await res.body()
    expect(png.readUInt32BE(PNG_WIDTH_AT)).toBe(1200)
    expect(png.readUInt32BE(PNG_HEIGHT_AT)).toBe(630)
  })

  test('links an icon, and /favicon.ico answers', async ({ request }) => {
    const html = await homeHtml(request, 'en')
    expect(html).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon\.ico"/)
    const res = await request.get('/favicon.ico')
    expect(res.status()).toBe(200)
  })
})
