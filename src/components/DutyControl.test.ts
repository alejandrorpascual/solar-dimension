import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { compute } from '../lib/sizing'
import { DutyControl, dutyOptions } from './DutyControl'

/** The language the picker renders in: the root route's data is not there outside the app, so the hook is stood in for. */
const view = vi.hoisted(() => ({ locale: 'en' as Locale }))
vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: view.locale, t: getDictionary(view.locale) }) }
})

const selected = (id: string, dutyOverrides: Record<string, number> = {}) =>
  compute({ qty: { [id]: 1 }, hours: 24, volts: 48, chemistry: 'lifepo4', dutyOverrides }, CATALOG_SNAPSHOT).items[0]!

test('a microwave can be set below its typical 8%, to 5% (the engine floor) or 10%', () => {
  expect(dutyOptions(selected('micro'))).toEqual([0.05, 0.08, 0.1, 0.25, 0.5, 0.75, 1])
})

test('a fridge keeps its typical 35% among the presets, which now start at 5%', () => {
  expect(dutyOptions(selected('fridge'))).toEqual([0.05, 0.1, 0.25, 0.35, 0.5, 0.75, 1])
})

test('a catalog duty on a new preset is listed once: the kettle at 5% and the well pump at 10%', () => {
  expect(dutyOptions(selected('kettle'))).toEqual([0.05, 0.1, 0.25, 0.5, 0.75, 1])
  expect(dutyOptions(selected('well'))).toEqual([0.05, 0.1, 0.25, 0.5, 0.75, 1])
})

/** The picker's options as a user reads them, and the one it shows as chosen. */
function picker(id: string, name: string, locale: Locale, dutyOverrides: Record<string, number> = {}) {
  view.locale = locale
  const html = renderToStaticMarkup(createElement(DutyControl, { item: selected(id, dutyOverrides), name, onDuty: () => {} }))
  const options = [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)]
  return { labels: options.map((o) => o[2]), chosen: options.filter((o) => /\bselected\b/.test(o[1]!)).map((o) => o[2]) }
}

describe('the microwave duty picker', () => {
  test('lists 5% of each hour above its typical 8%, in English and Spanish', () => {
    expect(picker('micro', 'Microwave (1000 W)', 'en').labels).toEqual([
      '5% of each hour', '8% · typical', '10% of each hour', '25% of each hour', '50% of each hour', '75% of each hour', '100% · never stops',
    ])
    expect(picker('micro', 'Microondas (1000 W)', 'es').labels).toEqual([
      '5% de cada hora', '8% · típico', '10% de cada hora', '25% de cada hora', '50% de cada hora', '75% de cada hora', '100% · no se apaga',
    ])
  })

  test('shows the typical 8% until 5% is chosen, then shows 5%', () => {
    expect(picker('micro', 'Microwave (1000 W)', 'en').chosen).toEqual(['8% · typical'])
    expect(picker('micro', 'Microwave (1000 W)', 'en', { micro: 0.05 }).chosen).toEqual(['5% of each hour'])
  })
})
