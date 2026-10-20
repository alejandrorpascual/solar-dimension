import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { compute } from '../lib/sizing'
import { KitSummary } from './KitSummary'

/** The language the kit renders in: the root route's data is not there outside the app, so the hook is stood in for. */
const view = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: view.locale, t: getDictionary(view.locale) }) }
})

/** The fine print under the kit, tags out. */
function finePrintUnderKit(locale: Locale): string {
  view.locale = locale
  const result = compute({ qty: { micro: 1 }, hours: 24, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
  const html = renderToStaticMarkup(createElement(KitSummary, { result, baseline: null, projectName: 'Home', quickEdit: null, onBatteryUnit: () => {} }))
  return /<p class="fine muted">([^<]*)<\/p>/.exec(html)?.[1] ?? ''
}

test('the fine print under the kit starts with every appliance counting in every hour of the window, in English and Spanish', () => {
  expect(finePrintUnderKit('en')).toMatch(/^Every appliance counts in every hour of the window\. Assumes 90%/)
  expect(finePrintUnderKit('es')).toMatch(/^Cada aparato cuenta en todas las horas del respaldo\. Supone 90%/)
})
