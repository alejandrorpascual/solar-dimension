import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useLocale } from '../hooks/useLocale'
import { getDictionary, type Locale } from '../i18n'
import { getLocale } from '../server/locale'
import stylesheet from '../styles.css?url'

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap'

export const Route = createRootRoute({
  beforeLoad: async (): Promise<{ locale: Locale; user: null }> => ({ locale: await getLocale(), user: null }),
  head: ({ match }) => {
    const t = getDictionary(match.context.locale)
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: `Solar Dimension · ${t.ui.brand}` },
        { name: 'description', content: t.ui.q1Help },
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

function ErrorScreen() {
  const { t } = useLocale()
  return (
    <main className="page">
      <h1>{t.ui.errorTitle}</h1>
      <a href="/">{t.ui.reload}</a>
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
  const { locale } = Route.useRouteContext()
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
