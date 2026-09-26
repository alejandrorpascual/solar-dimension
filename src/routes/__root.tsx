import { HeadContent, Outlet, Scripts, createRootRoute, type ErrorComponentProps } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { useLocale } from '../hooks/useLocale'
import { useRootData, type RootData } from '../hooks/useRootData'
import { DEFAULT_LOCALE, getDictionary } from '../i18n'
import { APP_NAME } from '../lib/brand'
import { shouldReloadForStaleChunk } from '../lib/stale-chunk'
import { getLocale } from '../server/locale'
import { getAuthFeatures, getSession } from '../server/session'
import stylesheet from '../styles.css?url'

const SEARCH_CONSOLE_TOKEN = 'G9yqTKOqSP1tOS4jjC6xGCcsVFT7J3iZC5AzXQ2LNFY'

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap'

export const Route = createRootRoute({
  // A loader, not beforeLoad: beforeLoad reruns on every navigation, loader data is cached. Moving between
  // steps only changes ?step, so this runs once per page load and again only on router.invalidate().
  loader: async (): Promise<RootData> => {
    const [locale, session, features] = await Promise.all([getLocale(), getSession(), getAuthFeatures()])
    return { locale, user: session?.user ?? null, googleEnabled: features.googleEnabled }
  },
  staleTime: Infinity,
  head: ({ loaderData }) => {
    const t = getDictionary(loaderData?.locale ?? DEFAULT_LOCALE)
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: APP_NAME },
        { name: 'description', content: t.ui.q1Help },
        // Proves ownership of solar-dimension.vercel.app to Google Search Console (needed for OAuth branding review).
        { name: 'google-site-verification', content: SEARCH_CONSOLE_TOKEN },
      ],
      links: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
        { rel: 'stylesheet', href: FONTS_URL },
        { rel: 'stylesheet', href: stylesheet },
      ],
    }
  },
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
 * says what actually failed.
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
      <p className="fine muted">{error instanceof Error ? `${error.name}: ${error.message}` : String(error)}</p>
    </main>
  )
}

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

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
