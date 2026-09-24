import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import stylesheet from '../styles.css?url'

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Solar Dimension · Kit builder' },
      {
        name: 'description',
        content: 'Pick the appliances that must stay on, set the outage length, and get the inverter, battery bank and cabling you need.',
      },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: FONTS_URL },
      { rel: 'stylesheet', href: stylesheet },
    ],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <main className="page">
      <h1>Page not found</h1>
      <a href="/">Back to the kit builder</a>
    </main>
  ),
  errorComponent: () => (
    <main className="page">
      <h1>Something interrupted the kit builder.</h1>
      <a href="/">Reload</a>
    </main>
  ),
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
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
