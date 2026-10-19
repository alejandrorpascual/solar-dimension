import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { ApplianceCard } from './ApplianceCard'

// The card reads its language from the root route's data; a test has no router, so the locale is set here.
const page = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('../hooks/useRootData', () => ({ useRootData: () => ({ locale: page.locale }) }))

const noop = () => {}

/** The card's text, as a reader sees it, for one catalog appliance not added yet. */
function cardText(id: string, locale: Locale): string {
  page.locale = locale
  const item = CATALOG_SNAPSHOT.find((a) => a.id === id)!
  const html = renderToStaticMarkup(createElement(ApplianceCard, { item, qty: 0, onInc: noop, onDec: noop, onSet: noop }))
  return html.replace(/<\/div>/g, '\n').replace(/<[^>]+>/g, ' ').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

const LINES = {
  en: { splitPhase: 'Needs a 240 V / split-phase inverter', nameplate: 'Check the nameplate for 240 V' },
  es: { splitPhase: 'Requiere un inversor de 240 V / fase partida', nameplate: 'Revisa en la placa si es de 240 V' },
} as const

describe.each(['en', 'es'] as const)('appliance card 240 V lines (%s)', (locale) => {
  const lines = LINES[locale]

  test('a 1.5-ton air conditioner shows the split-phase line; a 1-ton one does not', () => {
    expect(cardText('ac15c', locale).split('\n')).toContain(lines.splitPhase)
    expect(cardText('ac15i', locale).split('\n')).toContain(lines.splitPhase)
    expect(cardText('ac1c', locale)).not.toContain('240 V')
  })

  test('the well pump shows the line to check its nameplate for 240 V, and only the well pump', () => {
    expect(cardText('well', locale).split('\n')).toContain(lines.nameplate)
    expect(cardText('well', locale)).not.toContain(lines.splitPhase)
    expect(cardText('sump', locale)).not.toContain('240 V')
  })
})
