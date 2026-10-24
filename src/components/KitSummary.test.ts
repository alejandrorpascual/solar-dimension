import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import type { OversizeNote } from '../lib/oversize'
import { compute } from '../lib/sizing'
import { DEFAULT_QTY } from '../lib/store'
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

/** A microwave for 8 h on 12 V 100 Ah AGM units: the bank's continuous current and the fuse need attention. */
function twoFailingKitHtml(locale: Locale): string {
  view.locale = locale
  const result = compute({ qty: { micro: 1 }, hours: 8, volts: 12, chemistry: 'agm', batteryUnit: '12-100' }, CATALOG_SNAPSHOT)
  return renderToStaticMarkup(createElement(KitSummary, { result, baseline: null, projectName: 'Home', oversize: null, quickEdit: null, onBatteryUnit: () => {} }))
}

test('a kit with 2 failing checks says so right under its summary, as a button to the checks, in English and Spanish', () => {
  const en = twoFailingKitHtml('en')
  expect(en).toMatch(/<p class="muted">Backs up [^<]*<\/p><button type="button" class="attn"[^>]*>.*2 checks need attention<\/span><\/button>/)
  expect(en).toContain('<section class="checks" aria-label="Checks" id="kit-checks" tabindex="-1">')
  expect(twoFailingKitHtml('es')).toMatch(/<button type="button" class="attn"[^>]*>.*2 verificaciones necesitan atención<\/span><\/button>/)
})

test('a kit that passes every check shows no attention line', () => {
  view.locale = 'en'
  expect(kitHtml(null)).not.toContain('class="attn"')
})

test('with panels, the box under the parts list also says what the solar side does not size; without, it does not', () => {
  view.locale = 'en'
  const kit = (panels: number) => renderToStaticMarkup(createElement(KitSummary, {
    result: compute({ qty: { fridge: 1, lights: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels, sunHours: 5 } }, CATALOG_SNAPSHOT),
    baseline: null, projectName: 'Home', oversize: null, quickEdit: null, onBatteryUnit: () => {},
  }))
  const box = (html: string) => /<p class="estimate" role="note">([^<]*)<\/p>/.exec(html)?.[1].replace(/&#x27;/g, "'") ?? ''
  expect(box(kit(4))).toMatch(/before you buy or install anything\. This kit does not size the solar side's ground-fault and overvoltage protection, .* a qualified installer designs them\.$/)
  expect(kit(4)).toContain('Controller to battery: cable and fuse')
  expect(box(kit(0))).toMatch(/before you buy or install anything\.$/)
})

test('on screen, one controller-to-battery row per controller, in English and Spanish; none without panels', () => {
  const rows = (locale: Locale, panels: number | null) => {
    view.locale = locale
    const solar = panels === null ? null : { roofM2: 40, panels, sunHours: 5 }
    const html = renderToStaticMarkup(createElement(KitSummary, {
      result: compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', solar }, CATALOG_SNAPSHOT),
      baseline: null, projectName: 'Home', oversize: null, quickEdit: null, onBatteryUnit: () => {},
    }))
    return [...html.matchAll(/<tr class="part" role="row">(.*?)<\/tr>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  }
  // 12 panels wire as two strings of six, one 60 A controller each: two 80 A fuses, each on 4 AWG (85 A).
  const en = rows('en', 12).filter((r) => r.startsWith('Controller to battery'))
  expect(en).toHaveLength(1)
  expect(en[0]).toMatch(/^Controller to battery: cable and fuse Solar 80 A class T fuse · 4 AWG \(21\.2 mm²\) copper .* × 2$/)
  const es = rows('es', 12).filter((r) => r.startsWith('Controlador a batería'))
  expect(es).toHaveLength(1)
  expect(es[0]).toMatch(/^Controlador a batería: cable y fusible Solar Fusible de 80 A clase T · 4 AWG \(21\.2 mm²\) de cobre .* × 2$/)
  expect(rows('en', null).some((r) => r.startsWith('Controller to battery'))).toBe(false)
  expect(rows('es', 0).some((r) => r.startsWith('Controlador a batería'))).toBe(false)
})
