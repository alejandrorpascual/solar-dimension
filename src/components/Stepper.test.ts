import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { Stepper } from './Stepper'

/** The language the stepper renders in: the root route's data is not there outside the app, so the hook is stood in for. */
const view = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: view.locale, t: getDictionary(view.locale) }) }
})

/** The name the stepper's navigation landmark carries. */
function stepperName(locale: Locale): string | undefined {
  view.locale = locale
  const html = renderToStaticMarkup(createElement(Stepper, { step: 2, onGo: () => {}, hasAppliances: true }))
  return /<nav aria-label="([^"]*)"/.exec(html)?.[1]
}

test('the stepper is named in the page language', () => {
  expect(stepperName('en')).toBe('Steps')
  expect(stepperName('es')).toBe('Pasos')
})
