import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { computeProject } from '../lib/project-summary'
import { currentProject, initialStore, patchCurrent, setElectricalIn } from '../lib/store'
import type { Store } from '../lib/schema'
import { BackupWindow } from './BackupWindow'

/** The language step 2 renders in: the root route's data is not there outside the app, so the hook is stood in for. */
const view = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: view.locale, t: getDictionary(view.locale) }) }
})

function stepTwo(locale: Locale, setup: (store: Store) => Store = (store) => store): string {
  view.locale = locale
  const store = setup(initialStore())
  const result = computeProject(currentProject(store), CATALOG_SNAPSHOT)
  return renderToStaticMarkup(createElement(BackupWindow, { store, commit: () => {}, result }))
}

test('step 2 says every appliance counts in every hour of the window, in English and Spanish', () => {
  expect(stepTwo('en')).toContain('Every appliance counts in every hour of the window.')
  expect(stepTwo('es')).toContain('Cada aparato cuenta en todas las horas del respaldo.')
})

/** Step 2 for a 48 V kit of `qty`: the line under the "share a conduit" box, tags out, or '' when the box shows none. */
function bundlingHelp(locale: Locale, qty: Record<string, number>, bundled = true): string {
  const html = stepTwo(locale, (store) => setElectricalIn(patchCurrent(store, { qty, volts: 48 }), store.currentId, { bundled }))
  return /<span class="muted elec__check-help">([^<]*)<\/span>/.exec(html)?.[1] ?? ''
}

test('the bundling help gives the factor the engine applied to this kit\'s main cable, not a fixed 80%', () => {
  // The NEC table: up to three conductors share a conduit at full ampacity, four to six at 80%, seven to nine at 70%.
  // One water heater at 48 V is one run (two conductors); two need two runs (four conductors); three need four (eight).
  const factors = [[{ ac3i: 1 }, 100], [{ wheater: 2 }, 80], [{ wheater: 3 }, 70]] as const
  for (const [qty, percent] of factors) {
    expect(bundlingHelp('en', qty)).toBe(`Bundling factor on the main cable: ${percent}%`)
    expect(bundlingHelp('es', qty)).toBe(`Factor de agrupamiento del cable principal: ${percent}%`)
  }
})

test('with the box unticked there is no bundling factor to show, in either language', () => {
  // An unbundled run always gets factor 1: printing it would read 100% on a kit that drops to 80% once ticked.
  for (const locale of ['en', 'es'] as const) expect(bundlingHelp(locale, { wheater: 2 }, false)).toBe('')
})
