import { HeadContent, Outlet, Scripts, createRootRoute, type ErrorComponentProps } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { useLocale } from '../hooks/useLocale'
import { QuoteJobsProvider } from '../hooks/useQuoteJobs'
import { useRootData, type RootData } from '../hooks/useRootData'
import { DEFAULT_LOCALE, getDictionary } from '../i18n'
import { APP_NAME } from '../lib/brand'
import { serverErrorRef } from '../lib/server-error'
import { siteHead } from '../lib/site-head'
import { shouldReloadForStaleChunk } from '../lib/stale-chunk'
import { withFallback } from '../lib/ttl-cache'
import { QuoteTray } from '../components/quotes/QuoteTray'
import { getCatalog } from '../server/catalog'
import { getLocale } from '../server/locale'
import { getQuotePollMs } from '../server/quotes/api'
import { getAuthFeatures, getSession } from '../server/session'
import { getSiteOrigin } from '../server/site-origin'
import stylesheet from '../styles.css?url'

const SEARCH_CONSOLE_TOKEN = 'G9yqTKOqSP1tOS4jjC6xGCcsVFT7J3iZC5AzXQ2LNFY'

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap'

type SessionRead = Pick<RootData, 'user' | 'isAccountUnreachable'>

/**
 * The signed-in user, or nobody. Sizing needs no account, so a session that cannot be read (the database is down) opens
 * the page without one instead of failing it: the page says the account is unreachable and keeps nothing it does.
 */
const readSession = (): Promise<SessionRead> =>
  withFallback<SessionRead>(
    async () => ({ user: (await getSession())?.user ?? null, isAccountUnreachable: false }),
    { user: null, isAccountUnreachable: true },
    (error) => console.error('[root] the session could not be read; the page opens without the account', error),
  )

export const Route = createRootRoute({
  // A loader, not beforeLoad: beforeLoad reruns on every navigation, loader data is cached. Moving between
  // steps only changes ?step, so this runs once per page load and again only on router.invalidate().
  loader: async (): Promise<RootData> => {
    const [locale, session, features, catalog, quotePollMs, siteOrigin] = await Promise.all([
      getLocale(), readSession(), getAuthFeatures(), getCatalog(), getQuotePollMs(), getSiteOrigin(),
    ])
    return { locale, ...session, googleEnabled: features.googleEnabled, catalog, quotePollMs, siteOrigin }
  },
  staleTime: Infinity,
  head: ({ loaderData }) => {
    // The error screen can render before the loader has data: it keeps the product description, and names the image by a path with no origin.
    const site = siteHead(getDictionary(loaderData?.locale ?? DEFAULT_LOCALE), loaderData?.siteOrigin ?? '')
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: APP_NAME },
        ...site.meta,
        // Proves ownership of solar-dimension.vercel.app to Google Search Console (needed for OAuth branding review).
        { name: 'google-site-verification', content: SEARCH_CONSOLE_TOKEN },
      ],
      links: [
        ...site.links,
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
        { rel: 'stylesheet', href: FONTS_URL },
        { rel: 'stylesheet', href: stylesheet },
      ],
    }
  },
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorScreen,
})

function NotFound() {
  const { t } = useLocale()
  return (
    <main className="page">
      <h1>{t.ui.notFound}</h1>
      <a href="/">{t.ui.backHome}</a>
    </main>
  )
}

/**
 * A chunk that failed to load usually means the tab predates the current deploy, so it reloads once instead of
 * showing an error. Anything else shows the error's message, so a report from a device we cannot inspect (a phone)
 * says what actually failed. A failure on the server arrives as a reference and nothing else
 * (src/server/error-guard.ts): the page shows the reference, and the server log has the failure under it.
 */
function ErrorScreen({ error }: ErrorComponentProps) {
  const { t } = useLocale()
  const [isReloading, setIsReloading] = useState(false)
  useEffect(() => {
    console.error(error)
    if (!shouldReloadForStaleChunk(error)) return
    setIsReloading(true)
    window.location.reload()
  }, [error])
  if (isReloading) {
    return (
      <main className="page">
        <p className="muted" role="status">{t.ui.updating}</p>
      </main>
    )
  }
  return (
    <main className="page">
      <h1>{t.ui.errorTitle}</h1>
      <a href="/">{t.ui.reload}</a>
      <p className="fine muted">{errorDetail(error, t.ui.serverError)}</p>
    </main>
  )
}

/** The small print under the error page's heading. */
function errorDetail(error: unknown, serverErrorLabel: string): string {
  const ref = serverErrorRef(error)
  if (ref) return `${serverErrorLabel}: ${ref}`
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function RootComponent() {
  return (
    <QuoteJobsProvider>
      <Outlet />
      <QuoteTray />
    </QuoteJobsProvider>
  )
}

/**
 * The document around every screen, the error and not-found screens included: an error screen keeps the stylesheet
 * and the scripts, so it arrives styled and still runs (a stale chunk reloads the page).
 */
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { locale } = useRootData()
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
