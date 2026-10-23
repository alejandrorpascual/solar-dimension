import type { Dictionary } from '../i18n'
import { APP_NAME } from './brand'

/** The preview image's size is part of the contract with chat apps: they lay the card out from it before fetching. */
const SHARE_IMAGE_WIDTH = 1200
const SHARE_IMAGE_HEIGHT = 630
const SHARE_IMAGE_PATH = '/og.png'

interface MetaTag { name?: string; property?: string; content: string }
interface LinkTag { rel: string; href: string; type?: string; sizes?: string }

/**
 * What the head says about the app to anything that reads it without running it: a search result, a chat app
 * previewing a pasted link, a browser tab. `siteOrigin` is the scheme and host the app is served from (no trailing
 * slash): a preview image has to be named by an absolute URL because the app that fetches it is not on our page.
 */
export function siteHead(t: Dictionary, siteOrigin: string): { meta: MetaTag[]; links: LinkTag[] } {
  const description = t.ui.siteDescription
  return {
    meta: [
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: APP_NAME },
      { property: 'og:description', content: description },
      { property: 'og:image', content: `${siteOrigin}${SHARE_IMAGE_PATH}` },
      { property: 'og:image:width', content: String(SHARE_IMAGE_WIDTH) },
      { property: 'og:image:height', content: String(SHARE_IMAGE_HEIGHT) },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    // The .ico is what browsers fall back to and what crawlers ask for by name; the SVG is sharp at any size.
    links: [
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
    ],
  }
}
