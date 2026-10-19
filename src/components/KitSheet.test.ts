import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { getDictionary, type Locale } from '../i18n'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { buildParts } from '../lib/kit-parts'
import { compute, type SizingInput } from '../lib/sizing'
import { DEFAULT_QTY } from '../lib/store'
import { KitSheet, type ExportInclude } from './KitSheet'

const EVERYTHING: ExportInclude = { summary: true, appliances: true, parts: true, checks: true, notes: true, requester: true }
const NOTHING: ExportInclude = { summary: false, appliances: false, parts: false, checks: false, notes: false, requester: false }

/** The sheet as it prints, top to bottom: one line per block, tags out. */
function sheetText(input: SizingInput, locale: Locale, include: ExportInclude = EVERYTHING): string {
  const t = getDictionary(locale)
  const result = compute(input, CATALOG_SNAPSHOT)
  const html = renderToStaticMarkup(createElement(KitSheet, {
    projectName: 'Home', result, parts: buildParts(result, t, locale), requester: null, include, date: '12 Oct 2026', t, locale,
  }))
  return html
    // A check's mark is an icon with its word as the label: keep the word, as a screen reader would.
    .replace(/<span class="cmark[^"]*"[^>]*aria-label="([^"]*)"[^>]*>[\s\S]*?<\/span>/g, '[$1] ')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<\/(tr|h2|h3|p|div|section|header|li)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** The audit's 12 V stress project: the default home plus heaters, kettles and a 240 V water heater, 11 kW at 12 V. */
const STRESS_12V: SizingInput = { qty: { ...DEFAULT_QTY, heater: 2, kettle: 2, wheater: 1 }, hours: 10, volts: 12, chemistry: 'lifepo4' }
const SOUND: SizingInput = { qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4' }

describe('the spec sheet carries what a supplier must read', () => {
  test('the 12 V stress project prints the split-phase and inverter-voltage notes, in English and Spanish', () => {
    const en = sheetText(STRESS_12V, 'en')
    expect(en.split('\n')).toContain('Notes')
    expect(en).toContain('Electric water heater usually runs on 240 V. You need a split-phase (240 V) inverter or two stacked units.')
    expect(en).toContain('8,000 W inverters are normally built for 48 V. Change the battery voltage or trim the load.')
    const es = sheetText(STRESS_12V, 'es')
    expect(es.split('\n')).toContain('Notas')
    expect(es).toContain('Calentador de agua eléctrico normalmente funciona a 240 V. Necesitas un inversor de fase partida (240 V) o dos unidades acopladas.')
    expect(es).toContain('Los inversores de 8,000 W normalmente son de 48 V. Cambia el voltaje del banco o reduce la carga.')
  })

  test('the notes and the failing checks stay on the sheet with every Include box unticked', () => {
    const text = sheetText(STRESS_12V, 'en', NOTHING)
    expect(text).toContain('You need a split-phase (240 V) inverter')
    expect(text).toContain('8,000 W inverters are normally built for 48 V')
    // The checks that fail print; the ones that pass went with the Checks box.
    expect(text).toContain('[Needs attention]')
    expect(text).toContain('is hard to wire safely')
    expect(text).not.toContain('[Passes]')
    expect(sheetText(STRESS_12V, 'en')).toContain('[Passes]')
  })

  test('the first page says in one line that checks fail and notes exist, before anything else', () => {
    const text = sheetText(STRESS_12V, 'en')
    // Two 8 kW units carry the 11 kW, so the inverter check passes; the strings, the fuse and the cable still do not.
    const line = 'Read before quoting · Checks to resolve: 3 · Notes: 2'
    expect(text.split('\n')).toContain(line)
    expect(text.indexOf(line)).toBeLessThan(text.indexOf('Parts list'))
    expect(sheetText(STRESS_12V, 'en', NOTHING)).toContain(line)
    // The notes and the checks print last, so page one keeps the header, the figures and the parts.
    expect(text.indexOf('Load schedule')).toBeLessThan(text.indexOf('\nNotes\n'))
    expect(text.indexOf('\nNotes\n')).toBeLessThan(text.indexOf('\nChecks\n'))
    expect(sheetText(STRESS_12V, 'es')).toContain('Leer antes de cotizar · Verificaciones por resolver: 3 · Notas: 2')
  })

  test('only notes, or only failing checks, name just that in the line', () => {
    // A 4.5 kW water heater alone at 48 V: every check passes, two notes.
    const notesOnly = sheetText({ qty: { wheater: 1 }, hours: 2, volts: 48, chemistry: 'lifepo4' }, 'en')
    expect(notesOnly.split('\n')).toContain('Read before quoting · Notes: 2')
    expect(notesOnly).not.toContain('Checks to resolve')
    // Essentials on five strings of a small 12 V unit: the parallel-strings check fails, nothing else to note.
    const checksOnly = sheetText({ qty: DEFAULT_QTY, hours: 10, volts: 12, chemistry: 'lifepo4', batteryUnit: '12-100' }, 'en')
    expect(checksOnly).toMatch(/Read before quoting · Checks to resolve: 1$/m)
    expect(checksOnly.split('\n')).not.toContain('Notes')
  })

  test('a sound kit has no notice line and no notes block', () => {
    const text = sheetText(SOUND, 'en')
    expect(text).not.toContain('Read before quoting')
    expect(text.split('\n')).not.toContain('Notes')
    expect(sheetText(SOUND, 'en', NOTHING)).not.toContain('[Needs attention]')
  })

  test('a conventional AC prints the locked-rotor note under Notes and the AC duty in the assumptions, in English and Spanish', () => {
    const ac: SizingInput = { qty: { ...DEFAULT_QTY, ac1c: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }
    const en = sheetText(ac, 'en')
    expect(en.slice(en.indexOf('\nNotes\n'))).toContain('1 ton AC · conventional: the start-up surge is a rule of thumb, and the nameplate\'s locked-rotor amps can be higher.')
    expect(en).toContain('Air conditioning runs 50% of each hour on a typical day and 100% on a hard day.')
    const es = sheetText(ac, 'es')
    expect(es.slice(es.indexOf('\nNotas\n'))).toContain('Aire de 1 tonelada · convencional: el arranque es una estimación y la placa puede indicar más amperios de rotor bloqueado.')
    expect(es).toContain('El aire acondicionado funciona 50% de cada hora en un día típico y 100% en un día duro.')
  })

  test('an inverter AC prints its own typical duty but no locked-rotor note', () => {
    // The catalog runs a 1-ton inverter AC 60% of each hour, a conventional one 50%.
    const text = sheetText({ qty: { ...DEFAULT_QTY, ac1i: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, 'en')
    expect(text).toContain('Air conditioning runs 60% of each hour on a typical day and 100% on a hard day.')
    expect(text).not.toContain('locked-rotor')
  })

  test('appliances the catalog could not load are named as left out, so the sheet never under-reports in silence', () => {
    const text = sheetText({ ...SOUND, qty: { ...DEFAULT_QTY, gone1: 1, gone2: 2 } }, 'en')
    expect(text).toContain('2 appliances in this project could not be loaded, so this kit leaves them out.')
    expect(text).toContain('Read before quoting · Notes: 1')
  })
})

describe('the spec sheet says what it is', () => {
  const EN = 'An estimate for requesting quotes, not an installation design. Have a licensed electrician verify it against the actual equipment and your local electrical code before you buy or install anything.'
  const ES = 'Una estimación para pedir cotizaciones, no un diseño de instalación. Pide a un electricista matriculado que la verifique con los equipos reales y la normativa eléctrica local antes de comprar o instalar nada.'

  test('the estimate sentence prints in English and Spanish', () => {
    expect(sheetText(SOUND, 'en').split('\n')).toContain(EN)
    expect(sheetText(SOUND, 'es').split('\n')).toContain(ES)
  })

  test('no Include box takes it off, and it prints after the parts list and before the assumptions', () => {
    expect(sheetText(SOUND, 'en', NOTHING).split('\n')).toContain(EN)
    expect(sheetText(SOUND, 'es', NOTHING).split('\n')).toContain(ES)
    const text = sheetText(SOUND, 'en')
    expect(text.indexOf(EN)).toBeGreaterThan(text.indexOf('Parts list'))
    expect(text.indexOf(EN)).toBeLessThan(text.indexOf('Assumes 90% inverter efficiency'))
  })

  test('an empty project still says it', () => {
    expect(sheetText({ qty: {}, hours: 10, volts: 48, chemistry: 'lifepo4' }, 'en', NOTHING)).toContain(EN)
  })

  test.each<[string, ExportInclude]>([
    ['the parts list left out', { ...EVERYTHING, parts: false }],
    ['only the appliance list ticked', { ...NOTHING, appliances: true }],
    ['only the assumptions ticked', { ...NOTHING, notes: true }],
  ])('it stays with %s, in both languages', (_, include) => {
    expect(sheetText(SOUND, 'en', include).split('\n')).toContain(EN)
    expect(sheetText(SOUND, 'es', include).split('\n')).toContain(ES)
  })

  test('a kit with notes and failing checks carries it as well as them, whatever is ticked', () => {
    for (const include of [EVERYTHING, NOTHING]) {
      const text = sheetText(STRESS_12V, 'en', include)
      expect(text.split('\n')).toContain(EN)
      expect(text).toContain('You need a split-phase (240 V) inverter')
      expect(text).toContain('[Needs attention]')
      expect(sheetText(STRESS_12V, 'es', include).split('\n')).toContain(ES)
    }
  })
})
