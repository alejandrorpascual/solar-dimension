import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { siteHead } from './site-head'

const ORIGIN = 'https://solar-dimension.vercel.app'
/** What a search result shows before it cuts a description off. */
const SNIPPET_MAX_CHARS = 160

type Head = ReturnType<typeof siteHead>
const content = (head: Head, key: string): string | undefined => head.meta.find((m) => m.name === key || m.property === key)?.content

describe('siteHead', () => {
  test.each([['en', en], ['es', es]] as const)(
    'describes the product in %s, not the help of step 1',
    (_locale, dictionary) => {
      const description = content(siteHead(dictionary, ORIGIN), 'description')
      expect(description).toBeTruthy()
      expect(description).not.toBe(dictionary.ui.q1Help)
      expect(description!.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS)
      expect(description).toMatch(/solar/i)
    },
  )

  test('the two languages describe it in their own words', () => {
    expect(content(siteHead(es, ORIGIN), 'description')).not.toBe(content(siteHead(en, ORIGIN), 'description'))
  })

  test('the Open Graph description is the meta description', () => {
    const head = siteHead(en, ORIGIN)
    expect(content(head, 'og:description')).toBe(content(head, 'description'))
  })

  test('titles the preview with the product name and asks for a large image card', () => {
    const head = siteHead(en, ORIGIN)
    expect(content(head, 'og:title')).toBe('Solar Dimension')
    expect(content(head, 'twitter:card')).toBe('summary_large_image')
  })

  test('links a 1200x630 preview image by an absolute https URL', () => {
    const head = siteHead(en, ORIGIN)
    expect(content(head, 'og:image')).toBe('https://solar-dimension.vercel.app/og.png')
    expect(content(head, 'og:image:width')).toBe('1200')
    expect(content(head, 'og:image:height')).toBe('630')
  })

  test('joins the origin and the image path with one slash', () => {
    expect(content(siteHead(en, 'https://solar.example'), 'og:image')).toBe('https://solar.example/og.png')
  })

  test('links the favicon and the vector icon', () => {
    const hrefs = siteHead(en, ORIGIN).links.filter((l) => l.rel === 'icon').map((l) => l.href)
    expect(hrefs).toEqual(['/favicon.ico', '/icon.svg'])
  })
})
