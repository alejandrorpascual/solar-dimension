import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { Locale } from '../../i18n'
import { SAMPLE_QUOTES } from '../../lib/quote-fixtures'
import { DEFAULT_MUSTS } from '../../lib/quote-items'
import { ProjectSchema } from '../../lib/schema'
import { VerdictView, type VerdictData } from './VerdictView'

/**
 * The language the page renders in. The root route's data, the router and the server functions are not there outside
 * the app, so the hooks that read them are stood in for: the catalog is the snapshot, nobody is signed in, and a link is
 * a plain anchor. A static render runs no effect and no click, so the saves are never called.
 */
const page = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('../../hooks/useLocale', async () => {
  const { getDictionary } = await import('../../i18n')
  return { useLocale: () => ({ locale: page.locale, t: getDictionary(page.locale) }) }
})
vi.mock('../../hooks/useRootData', async () => {
  const { CATALOG_SNAPSHOT } = await import('../../lib/catalog-snapshot')
  return {
    useRootData: () => ({ locale: page.locale, user: null, isAccountUnreachable: false, googleEnabled: false, catalog: [...CATALOG_SNAPSHOT], quotePollMs: 3000 }),
  }
})
vi.mock('../../hooks/useQuoteJobs', () => ({ useQuoteJobs: () => ({ refresh: () => {} }) }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ className, children }: { className?: string; children?: ReactNode }) => createElement('a', { className }, children),
}))
vi.mock('../../server/quotes/api', () => ({
  deleteQuote: vi.fn(), retryQuote: vi.fn(), setQuoteMust: vi.fn(), setQuoteOverride: vi.fn(), setQuoteTotal: vi.fn(),
}))

/** A small home kit, 48 V LiFePO4 for 10 hours, that SolarTec's 12 kW inverter and 41 kWh bank fit with room to spare. */
const ESSENTIALS = { fridge: 1, lights: 1, router: 1, tv: 1, phone: 2, laptop: 1 }

type QuoteData = VerdictData['quotes'][number]

/** The verdict page for a project with these appliance counts and SolarTec's quote, read and ready unless `over` says otherwise. */
function verdictHtml(locale: Locale, qty: Record<string, number>, over: Partial<QuoteData> = {}): string {
  page.locale = locale
  const project = ProjectSchema.parse({ id: 'p1', name: 'Home', qty, custom: [], hours: 10, volts: 48, chemistry: 'lifepo4' })
  const data: VerdictData = {
    project, musts: DEFAULT_MUSTS, readAt: 0,
    quotes: [{
      id: 'solartec', fileName: 'solartec.pdf', label: null, status: 'ready', extraction: SAMPLE_QUOTES.solartec, overrides: {},
      totalOverride: null, createdAt: 0, seenAt: 0, retries: 0, pages: 2, ...over,
    }],
  }
  return renderToStaticMarkup(createElement(VerdictView, { data, progress: null, onReload: async () => {} }))
}

/** The page's heading and the line under it, tags out. */
function head(html: string): { title: string; sub: string } {
  return {
    title: /<h1 class="qv__title">([^<]*)<\/h1>/.exec(html)?.[1] ?? '',
    sub: /<p class="qv__sub">([^<]*)<\/p>/.exec(html)?.[1] ?? '',
  }
}

describe('the verdict for a kit missing an appliance', () => {
  test('with every appliance loaded, the fitting quote is crowned best fit', () => {
    const html = verdictHtml('en', ESSENTIALS)
    expect(html).toContain('qpanel--best')
    expect(head(html).title).toBe('SolarTec Caribe fits your kit for the least')
  })

  test('the same project with an appliance the catalog cannot load shows the warning, no best card and no ranking, in English and Spanish', () => {
    const qty = { ...ESSENTIALS, 'no-such-thing': 1 }
    const en = verdictHtml('en', qty)
    expect(head(en)).toEqual({
      title: 'Your kit is missing appliances',
      sub: '1 appliance in this project could not be loaded, so this kit leaves it out. Reload in a minute; if it is still missing, add it again.',
    })
    expect(en).not.toContain('qpanel--best')
    expect(en).not.toContain('Best fit')
    expect(en).not.toContain('qlist')

    const es = verdictHtml('es', qty)
    expect(head(es).title).toBe('A tu kit le faltan aparatos')
    expect(head(es).sub).toMatch(/^No se pudo cargar 1 aparato de este proyecto/)
    expect(es).not.toContain('qpanel--best')
  })
})

describe('a quote ranked on a total the user typed', () => {
  /** SolarTec with its total read as 648, so it ranks on the 6,480 the user typed. */
  const typed: Partial<QuoteData> = { status: 'needs_review', extraction: { ...SAMPLE_QUOTES.solartec, total: 648 }, totalOverride: 6480 }

  test('says so on its card, with Change total to type another, in English and Spanish', () => {
    const en = verdictHtml('en', ESSENTIALS, typed)
    expect(en).toContain('Total entered by you')
    expect(en).toContain('<button type="button" class="qlink">Change total</button>')
    expect(verdictHtml('es', ESSENTIALS, typed)).toContain('<button type="button" class="qlink">Cambiar total</button>')
  })

  test('a quote ranked on the total that was read offers no Change', () => {
    expect(verdictHtml('en', ESSENTIALS)).not.toContain('Change total')
  })
})
