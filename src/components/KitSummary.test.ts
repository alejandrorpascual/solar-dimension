import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import type { OversizeNote } from '../lib/oversize'
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
  return /<p class="fine muted">([^<]*)<\/p>/.exec(kitHtml(null))?.[1] ?? ''
}

/** The kit for a microwave over 24 h at 48 V, with the oversize note given. */
function kitHtml(oversize: OversizeNote | null): string {
  const result = compute({ qty: { micro: 1 }, hours: 24, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
  return renderToStaticMarkup(createElement(KitSummary, { result, baseline: null, projectName: 'Home', oversize, quickEdit: null, onBatteryUnit: () => {} }))
}

/** The oversize note over the battery picker, tags out. */
function noteOverPicker(locale: Locale, note: OversizeNote): string {
  view.locale = locale
  return /<p class="note-box">([^<]*)<\/p>/.exec(kitHtml(note))?.[1] ?? ''
}

test('the fine print under the kit starts with every appliance counting in every hour of the window, in English and Spanish', () => {
  expect(finePrintUnderKit('en')).toMatch(/^Every appliance counts in every hour of the window\. Assumes 90%/)
  expect(finePrintUnderKit('es')).toMatch(/^Cada aparato cuenta en todas las horas del respaldo\. Supone 90%/)
})

test('the oversize note writes a large ratio with thousands separators, like the figures around it', () => {
  // A 1 W load for 1 h at 48 V: a 1 Wh need on the 4.8 kWh bank.
  const note: OversizeNote = { ratio: 4800, needWh: 1, isSmallestBank: false, kitVolts: 48, inverterW: 3000, volts: 12, bankWh: 1200 }
  expect(noteOverPicker('en', note)).toMatch(/^This bank holds 4,800× the 1 Wh the load needs: it has to carry the full current of a 3,000 W inverter\./)
  // Latin American Spanish (es-419) groups thousands with a comma too.
  expect(noteOverPicker('es', note)).toMatch(/^Este banco guarda 4,800 veces los 1 Wh/)
})

test('the oversize note groups a need of 1,000 Wh or more with thousands separators too', () => {
  // The kit at exactly 3 times its need (oversize.test.ts): 1,600 Wh on the 48 V kit's 4.8 kWh bank; 24 V sizes 2.4 kWh.
  const note: OversizeNote = { ratio: 3, needWh: 1600, isSmallestBank: false, kitVolts: 48, inverterW: 3000, volts: 24, bankWh: 2400 }
  expect(noteOverPicker('en', note)).toBe('This bank holds 3× the 1,600 Wh the load needs: it has to carry the full current of a 3,000 W inverter. At 24 V the kit would size a 2.4 kWh bank, the smallest that passes the same checks.')
  expect(noteOverPicker('es', note)).toMatch(/^Este banco guarda 3 veces los 1,600 Wh que necesita la carga/)
})

test('a bank that is the smallest its voltage allows gets the note that says so, not the one about the inverter', () => {
  const note: OversizeNote = { ratio: 11, needWh: 209, isSmallestBank: true, kitVolts: 24, inverterW: 2000, volts: 12, bankWh: 1200 }
  expect(noteOverPicker('en', note)).toBe('This bank holds 11× the 209 Wh the load needs: the kit cannot build a smaller bank at 24 V. At 12 V the kit would size a 1.2 kWh bank, the smallest that passes the same checks.')
})
