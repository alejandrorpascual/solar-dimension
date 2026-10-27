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

/** The glossary on the kit step for a microwave over 24 h at 48 V: its disclosure tag, its summary and each entry, tags out. */
function glossary(locale: Locale) {
  view.locale = locale
  const result = compute({ qty: { micro: 1 }, hours: 24, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
  const html = renderToStaticMarkup(createElement(KitSummary, { result, baseline: null, projectName: 'Home', oversize: null, quickEdit: null, onBatteryUnit: () => {} }))
  const block = /<details class="[^"]*gloss[^"]*">[\s\S]*?<\/details>/.exec(html)?.[0] ?? ''
  const text = (pattern: RegExp) => [...block.matchAll(pattern)].map((m) => m[1]!.replace(/<[^>]+>/g, ''))
  return { tag: /^<details[^>]*>/.exec(block)?.[0] ?? '', summary: text(/<summary[^>]*>([\s\S]*?)<\/summary>/g)[0], terms: text(/<dt>([\s\S]*?)<\/dt>/g), bodies: text(/<dd[^>]*>([\s\S]*?)<\/dd>/g) }
}

test('the kit step has a closed Glossary disclosure that lists the 11 terms, in English and Spanish', () => {
  const [english, spanish] = [glossary('en'), glossary('es')]
  expect(english.tag).not.toContain('open')
  expect(english.summary).toBe('Glossary')
  expect(english.terms).toEqual([
    'Running watts', 'Start-up power', 'Surge rating', 'Inverter', 'Battery bank', 'Depth of discharge', 'In series and in parallel', 'BMS',
    'Fuse interrupting rating', 'Voltage drop', 'Hard day and light day',
  ])
  expect(spanish.summary).toBe('Glosario')
  expect(spanish.terms).toEqual([
    'Vatios en marcha', 'Potencia de arranque', 'Potencia pico', 'Inversor', 'Banco de baterías', 'Profundidad de descarga', 'En serie y en paralelo',
    'BMS', 'Capacidad de interrupción del fusible', 'Caída de voltaje', 'Día duro y día ligero',
  ])
  for (const g of [english, spanish]) expect(g.bodies).toHaveLength(11)
})

test('the inverter entry tells the device apart from inverter air conditioning', () => {
  expect(glossary('en').bodies[3]).toContain('inverter air conditioning')
  expect(glossary('es').bodies[3]).toContain('aire acondicionado inverter')
})

test('the hard day and light day entry states the runtime scenario figures', () => {
  // SIZING.SCENARIO: a light day runs cycling duties at 0.8 with a 93% inverter; a hard day at 1.3, every AC at 1, an 85% inverter.
  expect(glossary('en').bodies[10]).toBe('The range under the runtime. On a light day, appliances that cycle on and off run 80% of their typical time and the inverter is 93% efficient. On a hard day they run 130% of it, never past the whole hour, every air conditioner runs 100% of each hour and the inverter is 85% efficient.')
  expect(glossary('es').bodies[10]).toBe('El rango bajo la autonomía. En un día ligero, los aparatos que se encienden y apagan funcionan el 80% de su tiempo típico y el inversor tiene 93% de eficiencia. En un día duro funcionan el 130% de ese tiempo, sin pasar de la hora completa, cada aire acondicionado funciona el 100% de cada hora y el inversor tiene 85% de eficiencia.')
})
