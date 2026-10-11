/** What a product link tells us about whether the model made it up. */
export interface LinkCheck {
  url: string
  /** HTTP status after redirects; null when the request failed (DNS, TLS, timeout). */
  status: number | null
  /** The exact URL appeared in the web search results the model was given. */
  inSearch: boolean
  /** Some search result was on the same host. */
  hostInSearch: boolean
}

const TIMEOUT_MS = 10_000
/** Some shops answer a bare script with 403; a browser-like agent gives a fairer read of whether the page exists. */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Strips the tracking query OpenAI adds to cited links, so a cited URL matches the one the search returned. */
const normalize = (url: string): string => url.replace(/[?&]utm_source=openai$/, '').replace(/\/$/, '')

async function statusOf(url: string): Promise<number | null> {
  if (!/^https?:\/\//.test(url)) return null
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': USER_AGENT } })
    await res.body?.cancel()
    return res.status
  } catch {
    return null
  }
}

export async function checkLinks(urls: readonly string[], sources: readonly string[]): Promise<LinkCheck[]> {
  const seen = new Set(sources.map(normalize))
  const hosts = new Set(sources.map(hostOf).filter((h): h is string => h !== null))
  const unique = [...new Set(urls)]
  return Promise.all(
    unique.map(async (url) => {
      const host = hostOf(url)
      return { url, status: await statusOf(url), inSearch: seen.has(normalize(url)), hostInSearch: host !== null && hosts.has(host) }
    }),
  )
}
