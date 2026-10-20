import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { computeProject } from '../lib/project-summary'
import { currentProject, initialStore } from '../lib/store'
import { BackupWindow } from './BackupWindow'

/** The language step 2 renders in: the root route's data is not there outside the app, so the hook is stood in for. */
const view = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: view.locale, t: getDictionary(view.locale) }) }
})

function stepTwo(locale: Locale): string {
  view.locale = locale
  const store = initialStore()
  const result = computeProject(currentProject(store), CATALOG_SNAPSHOT)
  return renderToStaticMarkup(createElement(BackupWindow, { store, commit: () => {}, result }))
}

test('step 2 says every appliance counts in every hour of the window, in English and Spanish', () => {
  expect(stepTwo('en')).toContain('Every appliance counts in every hour of the window.')
  expect(stepTwo('es')).toContain('Cada aparato cuenta en todas las horas del respaldo.')
})
