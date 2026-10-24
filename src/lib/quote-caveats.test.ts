import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { fmtDecimal, fmtW } from '../i18n/format'
import { backupText, caveatsLine, caveatText } from './quote-caveat-text'
import { compareQuotes, entryKey, type QuoteView } from './quote-compare'
import { extraction, line, SAMPLE_KIT as KIT } from './quote-fixtures'
import { DEFAULT_MUSTS, type KitNeeds } from './quote-items'
import type { QuoteExtraction, QuoteLine } from './quote-schema'
import { bestPill, fitLabel, reasonLine, verdictHeading } from './quote-text'

let created = 0
const view = (id: string, x: QuoteExtraction, over: Partial<QuoteView> = {}): QuoteView => ({
  id, fileName: `${id}.pdf`, label: id, status: 'ready', extraction: x, overrides: {}, totalOverride: null, createdAt: created++, retries: 0, pages: null, ...over,
})
const inverter = (specs: object = {}) => line('inverter', 2000, { specs: { watts: 5000, surgeWatts: 10000, hasCharger: true, ...specs } })
const battery = (specs: object = { kWh: 5.12, chemistry: 'lifepo4' }, qty = 2) => line('battery', 3000, { qty, specs })
const rest = (): QuoteLine[] => [line('wiring', 150, { specs: { awg: '2/0' } }), line('fuse', 90, { specs: { fuseAmps: 175, fuseClass: 'T' } }), line('labor', 1000)]
/** A quote that meets every must-have of the sample kit and leaves nothing to confirm, unless a line is swapped. */
const clean = (swap: { inverter?: QuoteLine; battery?: QuoteLine } = {}, over: Partial<QuoteExtraction> = {}) =>
  extraction([swap.inverter ?? inverter(), swap.battery ?? battery(), ...rest()], over)
const only = (x: QuoteExtraction, kit: KitNeeds = KIT, over: Partial<QuoteView> = {}) => compareQuotes(kit, DEFAULT_MUSTS, [view('q', x, over)])
const caveatIds = (x: QuoteExtraction, kit: KitNeeds = KIT, over: Partial<QuoteView> = {}) => only(x, kit, over).ranked[0]!.caveats.map((c) => c.id)

describe('caveats of a quote that meets every must-have', () => {
  test('none for a quote that states everything the kit needs', () => {
    expect(only(clean()).best).toMatchObject({ fit: 'fits', caveats: [] })
  })
  test('an inverter that passes on its running power alone, with no surge rating stated', () => {
    expect(caveatIds(clean({ inverter: inverter({ watts: 10000, surgeWatts: null }) }))).toEqual(['surge_unstated'])
  })
  test('an inverter under the running load plus the 25% the kit sheet sizes with (AI-13, probe H1)', () => {
    // H1: a 2,630 W load on a 4,000 W kit sheet; a 3,000 W inverter covered it and read as right-sized.
    const kit: KitNeeds = { ...KIT, runningW: 2630, surgeW: 5000 }
    expect(only(clean({ inverter: inverter({ watts: 3000, surgeWatts: 6000 }) }), kit).best!.caveats).toEqual([{ id: 'no_headroom', needW: 3288 }])
    expect(caveatIds(clean({ inverter: inverter({ watts: 3300, surgeWatts: 6600 }) }), kit)).toEqual([])
  })
  test('a size the user confirmed instead of the quote (AI-14, probe E10)', () => {
    const vague = clean({ inverter: line('inverter', 2000, { specs: { watts: 5000, hasCharger: true } }), battery: line('battery', 3000, { specs: { ah: 100 } }) })
    const v = only(vague, KIT, { overrides: { inverter: 'included', battery: 'included' } })
    expect(v.best!.caveats).toEqual([{ id: 'confirmed', item: 'inverter' }, { id: 'confirmed', item: 'battery' }])
    expect(verdictHeading(en, v)).toBe('q is the cheapest that fits: confirm 2 things first')
  })
  test('confirming that an item the quote leaves out is included adds nothing: that is the installer’s word, not a size', () => {
    const noCharger = clean({ inverter: inverter({ hasCharger: null }) })
    expect(caveatIds(noCharger, KIT, { overrides: { charger: 'included' } })).toEqual([])
  })
  test('a bank that names no chemistry, though it is enough at the lowest depth of discharge', () => {
    expect(caveatIds(clean({ battery: battery({ batteryVolts: 12, ah: 400 }, 4) }))).toEqual(['chemistry_unstated'])
  })
  test('a bank of another chemistry than the kit', () => {
    expect(only(clean({ battery: battery({ batteryVolts: 12, ah: 400, chemistry: 'agm' }, 4) })).best!.caveats).toEqual([{ id: 'chemistry_differs', chemistry: 'agm' }])
  })
  test('every battery line is checked for its chemistry, not only the first that names one', () => {
    const twoBanks = (second: object) => extraction([inverter(), battery(), line('battery', 1500, { qty: 2, specs: second }), ...rest()])
    expect(only(twoBanks({ kWh: 5.12, chemistry: 'agm' })).best!.caveats).toEqual([{ id: 'chemistry_differs', chemistry: 'agm' }])
    expect(caveatIds(twoBanks({ kWh: 5.12 }))).toEqual(['chemistry_unstated'])
  })
  test("battery units that can't make up the kit's voltage, and an inverter for another voltage (AI-13, probe E5)", () => {
    // E5: a 48 V inverter with 2 × 12 V 400 Ah, a 24 V bank at most.
    expect(only(clean({ battery: battery({ batteryVolts: 12, ah: 400, chemistry: 'lifepo4' }, 2) })).best!.caveats).toEqual([{ id: 'bank_voltage', volts: 12 }])
    expect(caveatIds(clean({ inverter: inverter({ batteryVolts: 24 }) }))).toEqual(['inverter_voltage'])
    // A 240 V there is the inverter's AC output, which the reading has no other field for.
    expect(caveatIds(clean({ inverter: inverter({ batteryVolts: 240 }) }))).toEqual([])
  })
  test('nominal unit voltages make up the kit: 51.2 V for 48 V, two 25.6 V, four 12.8 V; three 12 V do not', () => {
    const bank = (batteryVolts: number, qty: number) => caveatIds(clean({ battery: battery({ batteryVolts, ah: 100, kWh: 10, chemistry: 'lifepo4' }, qty) }))
    expect([bank(51.2, 1), bank(25.6, 2), bank(12.8, 4)]).toEqual([[], [], []])
    expect([bank(25.6, 1), bank(12, 3)]).toEqual([['bank_voltage'], ['bank_voltage']])
    // Whole strings only: five 12 V leave one over, which the bank's energy can't count on.
    expect([bank(12, 5), bank(12, 8)]).toEqual([['bank_voltage'], []])
    expect(caveatIds(clean({ battery: battery({ batteryVolts: 24, ah: 400, chemistry: 'lifepo4' }, 2) }), { ...KIT, volts: 36 })).toEqual(['bank_voltage'])
  })
  test('units of one voltage make up the kit together, whichever lines list them: four 12 V as two lines of two', () => {
    const pair = () => battery({ batteryVolts: 12, ah: 400, chemistry: 'lifepo4' }, 2)
    expect(caveatIds(extraction([inverter(), pair(), pair(), ...rest()]))).toEqual([])
  })
  test('a total typed by the user', () => {
    expect(caveatIds(clean(), KIT, { status: 'needs_review', totalOverride: 6000 })).toEqual(['total_typed'])
  })
})

describe('tax stated on one quote and not on another (AI-04, probe E6)', () => {
  // E6: A states 6,340 + 18% tax = 7,481; B states 6,840 and no tax ("Precios no incluyen ITBIS").
  const withTax = clean({}, { subtotal: 6240, tax: 1123.2, total: 7363.2 })
  const noTax = extraction([inverter(), battery(), ...rest().map((l) => (l.kind === 'labor' ? { ...l, lineTotal: 1600 } : l))])
  const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('a', withTax), view('b', noTax)])
  test('the one that states none is still the cheapest, but no longer the plain best fit', () => {
    expect(v.best?.quote.id).toBe('b')
    expect(v.best?.caveats).toEqual([{ id: 'tax_unstated' }])
    expect(bestPill(en, v.best!)).toBe('Cheapest fit, to confirm')
    expect(verdictHeading(en, v)).toBe('b is the cheapest that fits: confirm 1 thing first')
  })
  test('the one with nothing to confirm says so, with what it costs more', () => {
    expect(entryKey(v.cleanFit!)).toBe('a')
    const a = v.ranked.find((r) => r.quote.id === 'a')!
    expect(reasonLine(en, a, v, KIT)).toBe(`Meets every must-have with nothing to confirm. Costs ${'$'}${(7363.2 - v.best!.total).toLocaleString('en-US', { maximumFractionDigits: 0 })} more.`)
    expect(fitLabel(en, a, v)).toBe('Meets all')
  })
  test('with no other quote stating tax, none is asked about', () => {
    expect(caveatIds(noTax)).toEqual([])
  })
  test('a tax line or an option tax counts as stating it', () => {
    const taxLine = extraction([...noTax.lines, line('other', 1000, { description: 'ITBIS 18%' })])
    const w = compareQuotes(KIT, DEFAULT_MUSTS, [view('a', taxLine), view('b', noTax)])
    expect(w.ranked.find((r) => r.quote.id === 'b')!.caveats).toEqual([{ id: 'tax_unstated' }])
    expect(w.ranked.find((r) => r.quote.id === 'a')!.caveats).toEqual([])
  })
  test('a line that names tax without charging it states none: "ITBIS no incluido"', () => {
    const excluded = extraction([...noTax.lines, line('other', 0, { description: 'ITBIS no incluido' })])
    const w = compareQuotes(KIT, DEFAULT_MUSTS, [view('a', withTax), view('b', excluded)])
    expect(w.ranked.find((r) => r.quote.id === 'b')!.caveats).toEqual([{ id: 'tax_unstated' }])
  })
  test("an option states tax for itself alone: its own tax, or a line it shares that names one", () => {
    const system = (option: string) => [inverter(), battery(), ...rest()].map((l) => ({ ...l, option }))
    const options = (shared: QuoteLine[]) => extraction([...system('o1'), ...system('o2'), ...shared], {
      total: 0, options: [{ id: 'o1', label: 'Taxed', total: null, tax: 1000 }, { id: 'o2', label: 'Untaxed', total: null, tax: null }],
    })
    const caveatsOf = (x: QuoteExtraction, optionId: string) => only(x).ranked.find((r) => r.optionId === optionId)!.caveats
    expect([caveatsOf(options([]), 'o1'), caveatsOf(options([]), 'o2')]).toEqual([[], [{ id: 'tax_unstated' }]])
    const sharedTax = options([line('other', 500, { description: 'IVA' })])
    expect([caveatsOf(sharedTax, 'o1'), caveatsOf(sharedTax, 'o2')]).toEqual([[], []])
  })
})

describe('ranking', () => {
  test('caveats never change which quote is cheapest; at the same price the one with fewer goes first', () => {
    const typed = view('typed', clean(), { status: 'needs_review', totalOverride: 6330 })
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [typed, view('plain', clean({}, { total: 6330 }))])
    expect(v.ranked.map((r) => r.quote.id)).toEqual(['plain', 'typed'])
    // Another installer's quote: the same reading twice would be one file uploaded twice, which ranks once.
    const other = clean({}, { vendor: { name: 'Other installer', contact: null } })
    const cheaper = compareQuotes(KIT, DEFAULT_MUSTS, [view('typed', other, { status: 'needs_review', totalOverride: 6000 }), view('plain', clean())])
    expect(cheaper.best?.quote.id).toBe('typed')
    expect(cheaper.cleanFit?.quote.id).toBe('plain')
  })
  test('there is no clean fit to point at when the best leaves nothing to confirm', () => {
    expect(only(clean()).cleanFit).toBeNull()
  })
})

describe('caveat text', () => {
  test('each caveat in full, in both languages', () => {
    expect(caveatText(en, { id: 'no_headroom', needW: 3288 }, KIT)).toBe(`No headroom: your kit sheet sizes the inverter at ${fmtW(3288, 'en')}, the running load plus 25%`)
    expect(caveatText(es, { id: 'confirmed', item: 'battery' }, KIT)).toBe('Banco de baterías: lo confirmaste tú, la cotización no lo dice')
    expect(caveatText(en, { id: 'chemistry_differs', chemistry: 'agm' }, KIT)).toBe('AGM lead-acid batteries, while your kit is planned for LiFePO₄ lithium')
    expect(caveatText(en, { id: 'bank_voltage', volts: 12 }, KIT)).toBe("Its 12 V batteries don't make up your kit's 48 V")
    expect(caveatText(es, { id: 'tax_unstated' }, KIT)).toBe('No indica impuestos y otra cotización sí: este total puede no incluirlos')
  })
  test("a row's line names each kind once", () => {
    expect(caveatsLine(en, [{ id: 'chemistry_unstated' }, { id: 'tax_unstated' }, { id: 'confirmed', item: 'inverter' }])).toBe('Confirm first: battery chemistry, tax, and inverter (confirmed by you)')
    expect(caveatsLine(en, [])).toBeNull()
  })
})

describe('expected backup on the card (AI-02)', () => {
  test('the hours the window scales to at this bank, and the price per usable kWh', () => {
    const r = only(clean()).best!
    const usable = 2 * 5120 * 0.85
    expect(backupText(en, r, KIT)).toBe(`About ${fmtDecimal((8 * usable) / 8000, 1, 'en')} h of backup at your load (you asked for 8 h) · $${Math.round(r.total / (usable / 1000)).toLocaleString('en-US')} per usable kWh`)
    expect(backupText(es, r, KIT)).toMatch(/^Unas .+ h de respaldo con tu carga \(pediste 8 h\) · .+ por kWh útil$/)
  })
  test('nothing when the bank’s usable energy is not known', () => {
    expect(backupText(en, only(clean({ battery: battery({ ah: 100 }, 1) })).ranked[0]!, KIT)).toBeNull()
  })
})
