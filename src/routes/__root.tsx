import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import stylesheet from '../styles.css?url'
export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Solar Dimension · Plan your backup power' }, { name: 'description', content: 'Build your home backup plan. Estimate inverter power, battery capacity, runtime, and DC cabling from your appliances.' }], links: [{ rel: 'stylesheet', href: stylesheet }] }),
  shellComponent: ({ children }: { children: ReactNode }) => <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>,
  notFoundComponent: () => <main><h1>Page not found</h1><a href="/">Return to the calculator</a></main>,
  errorComponent: () => <main><h1>Something interrupted the calculator.</h1><a href="/">Reload your plan</a></main>,
})
