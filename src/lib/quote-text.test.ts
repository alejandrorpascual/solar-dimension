import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { fmtDecimal, fmtKwh, fmtList, fmtW } from '../i18n/format'
import { compareQuotes, entryKey, type QuoteView, type RankedQuote, type UnrankedQuote, type UnrankedReason } from './quote-compare'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES, type SampleQuoteId } from './quote-fixtures'
import { checkItems, DEFAULT_MUSTS, type KitNeeds } from './quote-items'
import type { ProjectJobs } from './quote-jobs'
import type { Rejection } from './quote-limits'
import { gaugePos, GAUGE_ZONES, quoteSizing, sizingZone, type Sizing } from './quote-sizing'
import {
  askText, coverageLines, extraPanelsText, isTotalTyped, coverageMeta, deleteConfirmText, entrySubtitle, sizingSentence, deltaText, etaText, fitLabel, gaugeLabel, gaugeLegend, gaugeTitle, itemText, markLabel, misreadText, money, oversizeTip,
  projectLine, questionText, ratioLabel, readTotalText, reasonLine, rejectionText, totalHelp, unrankedTitle, verdictHeading, verdictStatus, verdictSubline,
  zoneName, zonePill,
} from './quote-text'

const view = (id: SampleQuoteId, i: number): QuoteView => ({
  id, fileName: `${id}.pdf`, label: null, status: 'ready', extraction: SAMPLE_QUOTES[id], overrides: {}, totalOverride: null, createdAt: i, retries: 0, pages: null,
})
const v = compareQuotes(KIT, DEFAULT_MUSTS, (['solartec', 'voltia', 'grupoluz', 'enerhogar'] as const).map(view))
const [solartec, voltia, grupoluz, enerhogar] = v.ranked as [RankedQuote, RankedQuote, RankedQuote, RankedQuote]

describe('verdict text', () => {
  test('heading and subline name the best fit', () => {
    expect(verdictHeading(en, v)).toBe('SolarTec Caribe fits your kit for the least')
    expect(verdictSubline(en, v, KIT)).toBe('$6,480, the cheapest of your 4 quotes that meets all 6 must-haves.')
    expect(verdictHeading(es, v)).toBe('SolarTec Caribe cumple con tu kit por menos')
  })
  test('with nothing that fits, the closest quote and its gap', () => {
    const none = compareQuotes(KIT, DEFAULT_MUSTS, [view('enerhogar', 0)])
    expect(verdictHeading(en, none)).toBe('None of your quotes fits yet')
    expect(verdictSubline(en, none, KIT)).toBe('EnerHogar is closest: its inverter is 3,560 W short.')
  })
  test('empty and reading', () => {
    const empty = compareQuotes(KIT, DEFAULT_MUSTS, [])
    expect(verdictHeading(en, empty)).toBe('No quotes yet')
    const reading = compareQuotes(KIT, DEFAULT_MUSTS, [{ ...view('solartec', 0), status: 'processing', extraction: null }])
    expect(verdictHeading(en, reading)).toBe('Reading your quotes')
  })
})

describe('when every quote failed', () => {
  const failed = (id: string): QuoteView => ({ ...view('solartec', 0), id, fileName: `${id}.pdf`, status: 'failed', extraction: null })
  const allFailed = compareQuotes(KIT, DEFAULT_MUSTS, ['a', 'b', 'c', 'd', 'e', 'f'].map(failed))
  test('the heading and subline say nothing could be read, in both languages', () => {
    expect(verdictHeading(en, allFailed)).toBe("We couldn't read your quotes")
    expect(verdictSubline(en, allFailed, KIT)).toBe('Retry them, or check that each file is an installer quote.')
    expect(verdictHeading(es, allFailed)).toBe('No pudimos leer tus cotizaciones')
    expect(verdictSubline(es, allFailed, KIT)).toBe('Vuelve a intentarlo, o comprueba que cada archivo sea una cotización de instalador.')
  })
  test('the status is a warning with the failed count, not a ready verdict', () => {
    expect(verdictStatus(en, allFailed)).toEqual({ tone: 'warn', label: "6 couldn't be read", meta: null })
    expect(verdictStatus(es, allFailed)).toEqual({ tone: 'warn', label: 'No se pudieron leer 6', meta: null })
    const one = compareQuotes(KIT, DEFAULT_MUSTS, [failed('a')])
    expect(verdictStatus(en, one)).toEqual({ tone: 'warn', label: "1 couldn't be read", meta: null })
    expect(verdictStatus(es, one)).toEqual({ tone: 'warn', label: 'No se pudo leer 1', meta: null })
  })
  test('with some quotes read, the verdict is ready and counts only those', () => {
    const mixed = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', 0), view('voltia', 1), failed('a')])
    expect(verdictStatus(en, mixed)).toEqual({ tone: 'ok', label: 'Verdict ready', meta: '2 quotes read' })
    expect(verdictStatus(en, compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', 0), failed('a')]))?.meta).toBe('1 quote read')
    expect(verdictHeading(en, mixed)).toBe('SolarTec Caribe fits your kit for the least')
  })
  test('with nothing finished there is no status', () => {
    expect(verdictStatus(en, compareQuotes(KIT, DEFAULT_MUSTS, []))).toBeNull()
  })
})

describe('totalHelp', () => {
  /** The quote as its unranked row gets it: a single-system SolarTec reading that needs review. */
  const unranked = (over: Partial<QuoteView>): UnrankedQuote =>
    compareQuotes(KIT, DEFAULT_MUSTS, [{ ...view('solartec', 0), status: 'needs_review', ...over }]).unranked[0]!
  const lineOff = { ...SAMPLE_QUOTES.solartec, lines: SAMPLE_QUOTES.solartec.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 1 } : l)) }
  const noLines = extraction([], { total: 5000 })

  test('a quote with no total asks for it, in both languages', () => {
    const u = unranked({ extraction: { ...SAMPLE_QUOTES.solartec, total: 0 } })
    expect(totalHelp(en, u)).toBe("We didn't find the total. Enter it to compare this quote.")
    expect(totalHelp(es, u)).toBe('No encontramos el total. Escríbelo para comparar esta cotización.')
  })
  test('beside the empty field: the total read, and what the lines and tax add up to when the two disagree (AI-11)', () => {
    const misread = { ...SAMPLE_QUOTES.solartec, total: 648 }
    expect(readTotalText(en, misread)).toBe('We read $648, but its lines and tax add up to $6,480.')
    expect(readTotalText(es, misread)).toBe(`Leímos ${money(es, 648, 'USD')}, pero sus líneas e impuestos suman ${money(es, 6480, 'USD')}.`)
    expect(readTotalText(en, SAMPLE_QUOTES.solartec)).toBe('We read $6,480.')
    expect(readTotalText(en, { ...SAMPLE_QUOTES.solartec, total: 0 })).toBeNull()
    // A line that doesn't hold leaves a total that does: no sum to set against it.
    expect(readTotalText(en, lineOff)).toBe('We read $6,480.')
  })
  test('a ranked card says when its total was typed', () => {
    const typed = compareQuotes(KIT, DEFAULT_MUSTS, [{ ...view('solartec', 0), status: 'needs_review', totalOverride: 6000 }]).best!
    expect(isTotalTyped(typed)).toBe(true)
    expect(isTotalTyped(solartec)).toBe(false)
  })
  test('a quote whose amounts do not add up keeps its text', () => {
    expect(totalHelp(en, unranked({ extraction: { ...SAMPLE_QUOTES.solartec, total: 648 } }))).toBe(
      "Some amounts don't add up. Correct the total to compare this quote.",
    )
  })
  test('read again and still not holding, a reading asks for the total as the quote writes it', () => {
    expect(totalHelp(en, unranked({ extraction: lineOff, retries: 1 }))).toBe(en.quotes.misreadTotalHelp)
    expect(totalHelp(es, unranked({ extraction: noLines, retries: 1 }))).toBe(es.quotes.noLinesTotalHelp)
  })
  test('before it is read again, a reading with no lines says so rather than blaming its line amounts', () => {
    expect(misreadText(en, lineOff, null, true)).toBe(en.quotes.misreadHelp)
    expect(misreadText(en, lineOff, null, false)).toBe(en.quotes.misreadHelpNoRetry)
    expect(misreadText(en, noLines, null, true)).toBe("We couldn't read any lines in this quote, so a total alone wouldn't say what it includes. Read it again, or upload a clearer copy.")
    expect(misreadText(es, noLines, null, false)).toBe(es.quotes.noLinesHelpNoRetry)
  })
  test('an implausible reading says its numbers cannot be right, not that its amounts disagree', () => {
    // SolarTec's battery line read as 5,120 kWh (Wh read as kWh): its amounts still add up.
    const tooBig = { ...SAMPLE_QUOTES.solartec, lines: SAMPLE_QUOTES.solartec.lines.map((l, i) => (i === 1 ? { ...l, specs: { ...l.specs, kWh: 5120 } } : l)) }
    expect(misreadText(en, tooBig, null, true)).toBe(
      "Some numbers we read can't be right for a real quote, like a size or amount far too large or a page the file doesn't have, so a total wouldn't fix it. Read it again, or upload a clearer copy.",
    )
    expect(misreadText(en, tooBig, null, false)).toBe(
      "Some numbers we read can't be right for a real quote, like a size or amount far too large or a page the file doesn't have, so a total wouldn't fix it. Upload a clearer copy.",
    )
    expect(misreadText(es, tooBig, null, true)).toBe(es.quotes.implausibleHelp)
    expect(misreadText(es, tooBig, null, false)).toBe(es.quotes.implausibleHelpNoRetry)
    // SolarTec cites page 2, which a one-page file does not have; read from two pages, only its line amount is off.
    expect(misreadText(en, SAMPLE_QUOTES.solartec, 1, true)).toBe(en.quotes.implausibleHelp)
    expect(misreadText(en, lineOff, 2, true)).toBe(en.quotes.misreadHelp)
  })
})

describe('row text', () => {
  test('reason lines', () => {
    expect(reasonLine(en, solartec, v, KIT)).toBe('Meets every must-have, and is the cheapest quote that does.')
    expect(reasonLine(en, voltia, v, KIT)).toBe('Also meets every must-have. Costs $820 more.')
    expect(reasonLine(en, grupoluz, v, KIT)).toBe("Doesn't mention a battery charger and a class T fuse.")
    expect(reasonLine(en, enerhogar, v, KIT)).toBe("Doesn't fit: its inverter is 3,560 W short.")
  })
  test('worth asking and the question to copy', () => {
    expect(askText(en, grupoluz, v)).toBe("Grupo Luz is $330 cheaper but doesn't mention a battery charger and a class T fuse. If the installer confirms them, it becomes the best fit.")
    expect(questionText(en, grupoluz)).toBe('Hi Grupo Luz, does your quote include a battery charger and a class T fuse?')
    expect(questionText(es, grupoluz)).toBe('Hola, Grupo Luz: ¿su cotización incluye un cargador de baterías y un fusible clase T?')
  })
  test('fit labels and deltas', () => {
    expect([solartec, voltia, grupoluz, enerhogar].map((r) => fitLabel(en, r, v))).toEqual(['Best fit', 'Meets all', '2 unclear', "Doesn't fit"])
    expect(deltaText(en, voltia)).toBe('$820 more than the best')
    expect(deltaText(en, grupoluz)).toBe('$330 less than the best')
    expect(deltaText(en, solartec)).toBe('')
    expect(deltaText(es, voltia)).toBe(`${money(es, 820, 'USD')} más que la mejor`)
  })
})

describe('itemText', () => {
  const items = (id: SampleQuoteId) => checkItems(SAMPLE_QUOTES[id], KIT)
  const get = (id: SampleQuoteId, item: string) => itemText(en, items(id).find((c) => c.id === item)!, KIT, 'USD')
  test('a short inverter names what the kit needs', () => {
    expect(get('enerhogar', 'inverter')).toEqual({ label: '300 W', detail: 'Your kit needs 3,860 W' })
  })
  test('an inverter whose start-up power is not stated shows its watts, and says what is missing', () => {
    const unstated = checkItems(extraction([line('inverter', 1, { specs: { watts: 5000 } })]), KIT).find((c) => c.id === 'inverter')!
    expect(unstated.status).toBe('unknown')
    expect(itemText(en, unstated, KIT, 'USD')).toEqual({ label: '5,000 W', detail: 'Start-up power not stated' })
    expect(itemText(es, unstated, KIT, 'USD')).toEqual({ label: '5,000 W', detail: 'No indica la potencia de arranque' })
  })
  test('the icon of an inverter whose start-up power is not stated says so, not that it is not mentioned', () => {
    const unstated = checkItems(extraction([line('inverter', 1, { specs: { watts: 5000 } })]), KIT).find((c) => c.id === 'inverter')!
    expect(markLabel(en, unstated)).toBe('Start-up power not stated')
    expect(markLabel(es, unstated)).toBe('No indica la potencia de arranque')
    const none = checkItems(extraction([line('labor', 1)]), KIT).find((c) => c.id === 'inverter')!
    expect(markLabel(en, none)).toBe('Not mentioned')
    expect(markLabel(en, items('solartec').find((c) => c.id === 'inverter')!)).toBe('Meets it')
    expect(markLabel(en, items('enerhogar').find((c) => c.id === 'inverter')!)).toBe('Too small')
  })
  test('an inverter the user confirmed as included reads as confirmed, even with its start-up power not stated', () => {
    const quote = extraction([line('inverter', 1, { specs: { watts: 5000 } })])
    const confirmed = checkItems(quote, KIT, { inverter: 'included' }).find((c) => c.id === 'inverter')!
    expect(confirmed.facts.surgeUnknown).toBe(true)
    expect(itemText(en, confirmed, KIT, 'USD')).toEqual({ label: '5,000 W', detail: 'Confirmed by you' })
    expect(itemText(es, confirmed, KIT, 'USD')).toEqual({ label: '5,000 W', detail: 'Confirmado por ti' })
    expect(markLabel(en, confirmed)).toBe('Meets it')
  })
  test('an inverter that covers the surge on its running watts alone, unconfirmed, still says its start-up power is not stated', () => {
    const big = checkItems(extraction([line('inverter', 1, { specs: { watts: KIT.surgeW } })]), KIT).find((c) => c.id === 'inverter')!
    expect(big.status).toBe('ok')
    expect(itemText(en, big, KIT, 'USD').detail).toBe('Start-up power not stated')
  })
  test('an inverter not mentioned at all still says so', () => {
    const none = checkItems(extraction([line('labor', 1)]), KIT).find((c) => c.id === 'inverter')!
    expect(itemText(en, none, KIT, 'USD')).toEqual({ label: 'Not mentioned', detail: null })
  })
  test('built-in charger, optional Wi-Fi, not mentioned, warranty', () => {
    expect(get('solartec', 'charger')).toEqual({ label: 'Included', detail: 'Built into the inverter' })
    expect(get('enerhogar', 'wifi')).toEqual({ label: 'Not included', detail: 'Optional, +$120' })
    expect(get('grupoluz', 'fuse')).toEqual({ label: 'Not mentioned', detail: null })
    expect(get('solartec', 'warranty')).toEqual({ label: '10 y battery / 5 y inverter', detail: null })
  })
})

describe('solar panels', () => {
  const solar: KitNeeds = { ...KIT, arrayW: 4400 }
  const panels = (qty: number, panelWatts: number | null) => line('panel', 1, { qty, specs: { panelWatts } })
  const item = (lines: Parameters<typeof extraction>[0]) => checkItems(extraction(lines), solar).find((c) => c.id === 'panels')!
  test('a short array says what the kit needs, and its gap is the watts missing', () => {
    expect(itemText(en, item([panels(6, 550)]), solar, 'USD')).toEqual({ label: fmtW(3300, 'en'), detail: `Your kit needs ${fmtW(4400, 'en')}` })
    const quote: QuoteView = { id: 'q', fileName: 'q.pdf', label: null, status: 'ready', extraction: extraction([panels(6, 550)]), overrides: {}, totalOverride: null, createdAt: 0, retries: 0, pages: null }
    const verdict = compareQuotes(solar, { ...DEFAULT_MUSTS, inverter: false, battery: false, charger: false, cables: false, fuse: false, installation: false }, [quote])
    expect(reasonLine(en, verdict.ranked[0]!, verdict, solar)).toBe(`Doesn't fit: its solar array is ${fmtW(1100, 'en')} short.`)
    expect(reasonLine(es, verdict.ranked[0]!, verdict, solar)).toBe(`No cumple: a los paneles les faltan ${fmtW(1100, 'es')}.`)
  })
  test('panels with no wattage are included, with their power to confirm', () => {
    expect(itemText(en, item([panels(8, null)]), solar, 'USD')).toEqual({ label: 'Included', detail: 'Size not stated' })
  })
  test("a battery-only kit's card says when a quote includes panels anyway", () => {
    const quote: QuoteView = { id: 'q', fileName: 'q.pdf', label: null, status: 'ready', extraction: extraction([...SAMPLE_QUOTES.solartec.lines, panels(8, 550)]), overrides: {}, totalOverride: null, createdAt: 0, retries: 0, pages: null }
    const r = compareQuotes(KIT, DEFAULT_MUSTS, [quote]).ranked[0]!
    expect(extraPanelsText(en, r, KIT)).toBe(`Also includes ${fmtW(4400, 'en')} of solar panels`)
    expect(extraPanelsText(es, r, KIT)).toBe(`También incluye ${fmtW(4400, 'es')} de paneles solares`)
    expect(extraPanelsText(en, r, solar)).toBeNull()
    expect(extraPanelsText(en, solartec, KIT)).toBeNull()
  })
  test('panels that state no wattage still explain the price, with no figure that would undercount them', () => {
    const ranked = (extra: Parameters<typeof extraction>[0]) => compareQuotes(KIT, DEFAULT_MUSTS, [{
      id: 'q', fileName: 'q.pdf', label: null, status: 'ready', extraction: extraction([...SAMPLE_QUOTES.solartec.lines, ...extra]), overrides: {}, totalOverride: null, createdAt: 0, retries: 0, pages: null,
    }]).ranked[0]!
    expect(extraPanelsText(en, ranked([panels(8, null)]), KIT)).toBe('Also includes solar panels')
    expect(extraPanelsText(es, ranked([panels(8, null)]), KIT)).toBe('También incluye paneles solares')
    expect(extraPanelsText(en, ranked([panels(6, 550), panels(2, null)]), KIT)).toBe('Also includes solar panels')
  })
})

describe('items a quote mentions without enough to judge them', () => {
  const judged = (lines: Parameters<typeof extraction>[0], id: string, kit: KitNeeds = KIT) => checkItems(extraction(lines), kit).find((c) => c.id === id)!
  const wiring = (awg: string | null, qty = 1) => line('wiring', 1, { qty, specs: { awg } })
  const fuse = (fuseAmps: number | null, qty = 1, fuseClass: string | null = 'T') => line('fuse', 1, { qty, specs: { fuseAmps, fuseClass } })
  test('cables and a fuse with no stated size are included, with the size to confirm, and their icon says so', () => {
    const cables = judged([wiring(null)], 'cables')
    expect(itemText(en, cables, KIT, 'USD')).toEqual({ label: 'Included', detail: 'Size not stated' })
    expect(itemText(es, judged([fuse(null)], 'fuse'), KIT, 'USD')).toEqual({ label: 'Incluido', detail: 'No indica la medida' })
    expect(markLabel(en, cables)).toBe('To confirm')
    expect(markLabel(es, cables)).toBe('Por confirmar')
  })
  test('a cable that must be more runs than the quote counts says how many', () => {
    const kit: KitNeeds = { ...KIT, designA: 231, ampacityByGauge: { ...KIT.ampacityByGauge, '1 AWG': 130 }, cableMm2: 42.4, cableGauge: '1 AWG' }
    expect(itemText(en, judged([wiring('1')], 'cables', kit), kit, 'USD')).toEqual({ label: '1 AWG', detail: "Needs 2 runs of this size; the quote doesn't say how many" })
    expect(itemText(es, judged([wiring('1')], 'cables', kit), kit, 'USD').detail).toBe('Hacen falta 2 tramos de esta medida; la cotización no dice cuántos')
  })
  test('a fuse of another class, one that needs parallel runs, and too few fuses each say what is open', () => {
    expect(itemText(en, judged([wiring('2/0'), fuse(175, 1, 'ANL')], 'fuse'), KIT, 'USD')).toEqual({ label: '175 A', detail: 'ANL fuse; your kit asks for class T' })
    expect(itemText(es, judged([wiring('2/0'), fuse(175, 1, 'ANL')], 'fuse'), KIT, 'USD').detail).toBe('Fusible ANL; tu kit pide clase T')
    expect(itemText(en, judged([wiring('4/0'), fuse(450)], 'fuse'), KIT, 'USD').detail).toBe("Needs 2 runs of 4/0 AWG in parallel; the quote doesn't say how many")
    const two: KitNeeds = { ...KIT, fuseCount: 2 }
    expect(itemText(en, judged([wiring('4/0'), fuse(200)], 'fuse', two), two, 'USD').detail).toBe('Your kit lists 2 × 175 A; the quote, 1')
  })
  test("a fuse that states no class asks for the kit's", () => {
    expect(itemText(en, judged([wiring('2/0'), fuse(175, 1, null)], 'fuse'), KIT, 'USD')).toEqual({ label: '175 A', detail: 'Class not stated; your kit asks for class T' })
    expect(itemText(es, judged([wiring('2/0'), fuse(175, 1, null)], 'fuse'), KIT, 'USD').detail).toBe('No indica la clase; tu kit pide clase T')
  })
  test('a fuse too big for its thin cable is short, and the gap names both', () => {
    const kit: KitNeeds = { ...KIT, fuseA: 125, cableMm2: 42.4, cableGauge: '1 AWG' }
    const x = extraction([line('inverter', 1, { specs: { watts: 5000, surgeWatts: 10000, hasCharger: true } }), line('battery', 1, { qty: 2, specs: { kWh: 5.12, chemistry: 'lifepo4' } }), wiring('1'), fuse(250), line('labor', 1)])
    const quote: QuoteView = { id: 'q', fileName: 'q.pdf', label: null, status: 'ready', extraction: x, overrides: {}, totalOverride: null, createdAt: 0, retries: 0, pages: null }
    const r = compareQuotes(kit, DEFAULT_MUSTS, [quote]).ranked[0]!
    const c = r.items.find((i) => i.id === 'fuse')!
    expect(itemText(en, c, kit, 'USD')).toEqual({ label: '250 A', detail: 'Too big for 1 AWG, which carries 130 A' })
    expect(reasonLine(en, r, compareQuotes(kit, DEFAULT_MUSTS, [quote]), kit)).toBe("Doesn't fit: its 250 A fuse is too big for its 1 AWG cable.")
    expect(reasonLine(es, r, compareQuotes(kit, DEFAULT_MUSTS, [quote]), kit)).toBe('No cumple: su fusible de 250 A es demasiado grande para su cable 1 AWG.')
  })
  test('a bank whose chemistry decides the verdict shows both figures; one counted at a stated depth shows the sum', () => {
    const range = judged([line('battery', 1, { qty: 4, specs: { batteryVolts: 12, ah: 200 } })], 'battery')
    expect(itemText(en, range, KIT, 'USD')).toEqual({
      label: 'Included', detail: `Chemistry not stated: ${fmtKwh(4800, 'en')} usable if AGM lead-acid, ${fmtKwh(8160, 'en')} if LiFePO₄ lithium`,
    })
    expect(itemText(es, range, KIT, 'USD').detail).toMatch(/^No indica la química: /)
    const solartecBattery = checkItems(SAMPLE_QUOTES.solartec, KIT).find((c) => c.id === 'battery')!
    expect(itemText(en, solartecBattery, KIT, 'USD').detail).toBe(`${fmtKwh(8 * 5120, 'en')} × 85% depth of discharge`)
    const assumed = judged([line('battery', 1, { qty: 4, specs: { batteryVolts: 12, ah: 400 } })], 'battery')
    expect(itemText(en, assumed, KIT, 'USD').detail).toBe(`${fmtKwh(19200, 'en')} × 50%, chemistry not stated`)
  })
  test('a battery or an inverter line with no size is included, with its capacity or power to confirm', () => {
    expect(itemText(en, judged([line('battery', 1)], 'battery'), KIT, 'USD')).toEqual({ label: 'Included', detail: 'Capacity not stated' })
    expect(itemText(en, judged([line('inverter', 1)], 'inverter'), KIT, 'USD')).toEqual({ label: 'Included', detail: 'Power not stated' })
  })
  test('the coverage line keeps what the quote leaves to confirm apart from what it does not mention', () => {
    const items = checkItems(extraction([wiring(null), line('labor', 1)]), KIT)
    expect(coverageLines(en, items)).toEqual([
      { kind: 'ok', text: 'Includes installation' },
      { kind: 'unclear', text: 'To confirm: cables' },
      { kind: 'unknown', text: `Doesn't mention ${fmtList(['charger', 'Wi-Fi', 'fuse'], 'en')}` },
    ])
  })
  describe('reason, ask and question', () => {
    const good = [line('inverter', 2000, { specs: { watts: 5000, surgeWatts: 10000 } }), line('battery', 3000, { qty: 2, specs: { kWh: 5.12, chemistry: 'lifepo4' } }), fuse(175, 1, 'T'), line('labor', 1000)]
    const rank = (lines: Parameters<typeof extraction>[0], kit: KitNeeds = KIT) => {
      const quote: QuoteView = { id: 'q', fileName: 'q.pdf', label: 'Luz', status: 'ready', extraction: extraction(lines), overrides: {}, totalOverride: null, createdAt: 0, retries: 0, pages: null }
      const verdict = compareQuotes(kit, DEFAULT_MUSTS, [quote])
      return { r: verdict.ranked[0]!, verdict }
    }
    test('a quote that leaves something out and something open says both', () => {
      const { r, verdict } = rank([...good, wiring(null)])
      expect(r.unknownMusts).toEqual(['charger', 'cables'])
      expect(reasonLine(en, r, verdict, KIT)).toBe("Doesn't mention a battery charger. Doesn't confirm the size of the main cables.")
      expect(askText(en, r, verdict)).toBe("Luz doesn't mention a battery charger and doesn't confirm the size of the main cables. If the installer confirms them, it fits your kit.")
      expect(questionText(en, r)).toBe('Hi Luz, does your quote include a battery charger? Could you also confirm the size of the main cables?')
      expect(questionText(es, r)).toBe('Hola, Luz: ¿su cotización incluye un cargador de baterías? ¿Podría confirmar también la medida de los cables principales?')
    })
    test('a quote that only leaves things open asks to confirm them', () => {
      const { r, verdict } = rank([...good.map((l) => (l.kind === 'inverter' ? { ...l, specs: { ...l.specs, hasCharger: true } } : l)), wiring(null)])
      expect(reasonLine(es, r, verdict, KIT)).toBe('No confirma la medida de los cables principales.')
      expect(questionText(en, r)).toBe('Hi Luz, could you confirm the size of the main cables?')
    })
    test('each open point has its own phrase, so the question names what to check', () => {
      const ask = (lines: Parameters<typeof extraction>[0]) => questionText(en, rank(lines).r)
      const noCharger = good.map((l) => (l.kind === 'inverter' ? { ...l, specs: { ...l.specs, hasCharger: true } } : l))
      const withFuse = (f: ReturnType<typeof fuse>, w = wiring('2/0')) => [...noCharger.filter((l) => l.kind !== 'fuse'), f, w]
      expect(ask(withFuse(fuse(175, 1, 'ANL')))).toBe('Hi Luz, could you confirm a class T fuse instead of ANL?')
      expect(questionText(en, rank(withFuse(fuse(175, 1, 'T')), { ...KIT, fuseClass: 'ANL' }).r)).toBe('Hi Luz, could you confirm a class ANL fuse instead of T?')
      expect(ask(withFuse(fuse(175, 1, null)))).toBe('Hi Luz, could you confirm that the fuse is class T?')
      expect(questionText(es, rank(withFuse(fuse(175, 1, null))).r)).toBe('Hola, Luz: ¿podría confirmar que el fusible es clase T?')
      expect(ask(withFuse(fuse(450), wiring('4/0')))).toBe('Hi Luz, could you confirm that the 450 A fuse protects 2 runs of 4/0 AWG in parallel?')
      expect(ask(withFuse(fuse(null)))).toBe('Hi Luz, could you confirm the rating of the fuse?')
      const unsure = noCharger.map((l) => (l.kind === 'battery' ? { ...l, qty: 4, specs: { ...l.specs, kWh: null, batteryVolts: 12, ah: 200, chemistry: null } } : l))
      expect(ask([...unsure, wiring('2/0')])).toBe('Hi Luz, could you confirm the battery chemistry?')
      const surge = noCharger.map((l) => (l.kind === 'inverter' ? { ...l, specs: { ...l.specs, surgeWatts: null } } : l))
      expect(questionText(es, rank([...surge, wiring('2/0')]).r)).toBe('Hola, Luz: ¿podría confirmar la potencia de arranque del inversor?')
    })
  })
})

describe('status and progress text', () => {
  const jobs = (over: Partial<ProjectJobs>): ProjectJobs => ({
    projectId: 'p', projectName: 'Home', files: [], total: 4, done: 4, pending: 0, failed: 0, needsReview: 0, kitEmpty: false, unseen: false, best: null, ...over,
  })
  test('project line', () => {
    expect(projectLine(en, jobs({ done: 2, pending: 2 }))).toBe('Reading quotes 2/4')
    expect(projectLine(en, jobs({ kitEmpty: true }))).toBe('Add appliances to compare your quotes')
    expect(projectLine(es, jobs({ kitEmpty: true }))).toBe('Agrega aparatos para comparar tus cotizaciones')
    expect(projectLine(en, jobs({ best: { name: 'SolarTec Caribe', optionLabel: null, total: 6480, currency: 'USD' } }))).toBe('Verdict ready · SolarTec Caribe · $6,480')
    expect(projectLine(en, jobs({ failed: 1 }))).toBe('Check 1 of your quotes')
    expect(projectLine(en, jobs({}))).toBe('Verdict ready · none fits yet')
  })
  test('rejections carry the limit', () => {
    expect(rejectionText(en, { code: 'size', mb: 5.2 })).toBe('That file is 5.2 MB. The limit is 4 MB.')
    expect(rejectionText(en, { code: 'pages', pages: 6 })).toBe('That PDF has 6 pages. The limit is 5.')
    expect(rejectionText(es, { code: 'pages', pages: 6 })).toBe('Ese PDF tiene 6 páginas. El límite es 5.')
  })
  test('an account that may not start reads is told it needs a verified account, in both languages', () => {
    expect(rejectionText(en, { code: 'unverified' })).toBe('Uploading quotes needs a verified account.')
    expect(rejectionText(es, { code: 'unverified' })).toBe('Para subir cotizaciones necesitas una cuenta verificada.')
  })
  test('every refusal has its own text, in both languages', () => {
    const all: Rejection[] = [
      { code: 'type' }, { code: 'size', mb: 5 }, { code: 'pages', pages: 6 }, { code: 'encrypted' }, { code: 'project_limit' },
      { code: 'month_limit' }, { code: 'not_saved' }, { code: 'upload' }, { code: 'unverified' }, { code: 'daily_limit' },
    ]
    for (const t of [en, es]) {
      const texts = all.map((r) => rejectionText(t, r))
      expect(texts.every((x) => x.length > 0)).toBe(true)
      expect(new Set(texts).size).toBe(all.length)
    }
  })
  test('a spent daily budget pauses reading until tomorrow, in both languages', () => {
    expect(rejectionText(en, { code: 'daily_limit' })).toBe('Quote reading is paused for today. Try again tomorrow.')
    expect(rejectionText(es, { code: 'daily_limit' })).toBe('La lectura de cotizaciones está en pausa por hoy. Vuelve a intentarlo mañana.')
  })
  test('ETA in seconds, then minutes', () => {
    expect(etaText(en, 45)).toBe('45 s')
    expect(etaText(en, 120)).toBe('2 min')
  })
})

const at = (ratio: number): Sizing => ({ have: ratio * 1000, need: 1000, ratio, zone: sizingZone(ratio), pos: gaugePos(ratio) })

describe('a quote that offers two systems', () => {
  const jobs = (): ProjectJobs => ({ projectId: 'p', projectName: 'Home', files: [], total: 1, done: 1, pending: 0, failed: 0, needsReview: 0, kitEmpty: false, unseen: false, best: null })
  const suna: QuoteView = { ...view('suna', 9), fileName: 'suna.pdf' }
  const both = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', 0), suna])
  const o2 = both.ranked.find((r) => r.optionId === 'o2')!
  test('the subtitle says which option, its label and the file, in English and Spanish', () => {
    expect(entrySubtitle(en, o2)).toBe('Option 2 of 2 · Inversor 10 kW · suna.pdf')
    expect(entrySubtitle(es, o2)).toBe('Opción 2 de 2 · Inversor 10 kW · suna.pdf')
  })
  test('an option of a quote named by its file leaves the file out of the subtitle', () => {
    const unnamed: QuoteView = { ...suna, extraction: { ...SAMPLE_QUOTES.suna, vendor: { name: null, contact: null } } }
    const o1 = compareQuotes(KIT, DEFAULT_MUSTS, [unnamed]).ranked.find((r) => r.optionId === 'o1')!
    expect(entrySubtitle(en, o1)).toBe('Option 1 of 2 · Inversor 3 kW')
  })
  test('the subline counts quotes, not options', () => {
    const subBest = (r: RankedQuote, count: number, musts: number) =>
      en.quotes.subBest.replace('{total}', money(en, r.total, r.currency)).replace('{count}', String(count)).replace('{musts}', String(musts))
    expect(both.ranked).toHaveLength(3)
    expect(verdictSubline(en, both, KIT)).toBe(subBest(both.best!, 2, both.mustCount))
  })
  test('one quote that offers two systems reads as one quote', () => {
    const inverterOnly = { ...DEFAULT_MUSTS, battery: false, charger: false, cables: false, fuse: false, installation: false }
    const alone = compareQuotes(KIT, inverterOnly, [suna])
    const expected = en.quotes.subBestOne.replace('{total}', money(en, alone.best!.total, alone.best!.currency)).replace('{musts}', String(alone.mustCount))
    expect(alone.ranked).toHaveLength(2)
    expect(verdictSubline(en, alone, KIT)).toBe(expected)
  })
  test('a single-system quote keeps the file name as its subtitle', () => {
    expect(entrySubtitle(en, both.best!)).toBe('solartec.pdf')
  })
  test('asking about the option names it, while the question to the installer greets the vendor', () => {
    expect(askText(en, o2, both)).toContain('SUNA M.P. · Inversor 10 kW')
    expect(questionText(en, o2)).toMatch(/^Hi SUNA M\.P\., /)
  })
  test('the best fit is told apart by option, not by quote', () => {
    const alone = compareQuotes(KIT, { ...DEFAULT_MUSTS, battery: false, charger: false, cables: false, fuse: false, installation: false }, [suna])
    const [first, second] = alone.ranked as [RankedQuote, RankedQuote]
    expect(entryKey(alone.best!)).toBe('suna:o2')
    // Its 10 kW inverter passes on its running power alone: the quote states no start-up power, so it is one thing to confirm.
    expect(fitLabel(en, first, alone)).toBe(en.quotes.bestFitToConfirm)
    expect(fitLabel(en, second, alone)).not.toBe(en.quotes.bestFitToConfirm)
    expect(verdictHeading(en, alone)).toBe('SUNA M.P. · Inversor 10 kW is the cheapest that fits: confirm 1 thing first')
  })
  test('the delete confirmation counts the options it removes', () => {
    expect(deleteConfirmText(en, 0)).toBe('Delete this quote and its file?')
    expect(deleteConfirmText(en, 2)).toBe('Delete this quote, its 2 options and its file?')
    expect(deleteConfirmText(es, 2)).toBe('¿Eliminar esta cotización, sus 2 opciones y su archivo?')
  })
  test('the project line names the best option', () => {
    const j = { ...jobs(), best: { name: 'SUNA M.P.', optionLabel: 'Inversor 10 kW', total: 6200, currency: 'USD' } }
    expect(projectLine(en, j)).toBe('Verdict ready · SUNA M.P. · Inversor 10 kW · $6,200')
  })
})

describe('sizing text', () => {
  const sol = quoteSizing(solartec.items, KIT)
  const ener = quoteSizing(enerhogar.items, KIT)

  test('zone names are short enough for the gauge, in both languages', () => {
    expect(GAUGE_ZONES.map((z) => zoneName(en, z.zone))).toEqual(['Short', 'Snug', 'Roomy', 'Oversized'])
    expect(GAUGE_ZONES.map((z) => zoneName(es, z.zone))).toEqual(['Falta', 'Justo', 'Holgado', 'De más'])
  })
  test('the pill says how far from the need, per zone', () => {
    expect(zonePill(en, at(3.1088))).toBe('3.1× what it needs')
    expect(zonePill(en, at(2.01))).toBe('2.01× what it needs')
    expect(zonePill(en, at(2.06))).toBe('2.1× what it needs')
    expect(zonePill(en, at(1.302))).toBe('+31%, with room to spare')
    expect(zonePill(en, at(1.6))).toBe('+60%, with room to spare')
    expect(zonePill(en, at(1.19))).toBe('+19%, right-sized')
    expect(zonePill(en, at(1.004))).toBe('Exactly what it needs')
    expect(zonePill(en, at(0.996))).toBe('99% of what it needs')
    expect(zonePill(en, at(0.476))).toBe('47% of what it needs')
    expect(zonePill(es, at(1.19))).toBe('+19 %, a la medida')
    expect(zonePill(es, at(0.476))).toBe('47 % de lo necesario')
    expect(zonePill(es, at(3.1088))).toBe(`${fmtDecimal(3.1088, 1, 'es')}× lo necesario`)
  })
  test('the mini bar label is a multiple from 1×, a percent below', () => {
    expect(ratioLabel(en, 1.15)).toBe('1.15×')
    expect(ratioLabel(en, 25.806)).toBe('25.8×')
    expect(ratioLabel(en, 0.476)).toBe('47%')
    expect(ratioLabel(es, 0.476)).toBe('47 %')
  })
  test('gauge title and accessible name', () => {
    expect(gaugeTitle(en, 'inverter', sol.inverter!)).toBe('Inverter 12.0 kW')
    expect(gaugeTitle(en, 'battery', sol.battery!)).toBe('Battery 34.8 kWh usable')
    expect(gaugeTitle(es, 'inverter', sol.inverter!)).toBe(`Inversor ${fmtW(12000, 'es')}`)
    expect(gaugeTitle(es, 'battery', sol.battery!)).toBe(`Batería ${fmtKwh(34816, 'es')} útiles`)
    expect(gaugeLabel(en, 'inverter', sol.inverter!)).toBe('Inverter: 12.0 kW against 3,860 W needed, oversized')
    expect(gaugeLabel(en, 'battery', ener.battery!)).toBe('Battery: 1.1 kWh against 8.0 kWh needed, short')
    expect(gaugeLabel(es, 'inverter', sol.inverter!)).toBe(`Inversor: ${fmtW(12000, 'es')} frente a ${fmtW(3860, 'es')} necesarios, de más`)
  })
  test('the legend takes its numbers from the zone constants', () => {
    expect(gaugeLegend(en)).toBe('Snug: up to 30% more than your kit uses. Oversized: more than double.')
    expect(gaugeLegend(es)).toBe('Justo: hasta 30 % más de lo que usa tu kit. De más: más del doble.')
  })
  test('the oversize tip suggests a size that still starts the kit', () => {
    expect(oversizeTip(en, KIT, sol)).toBe("The inverter is more than double what your kit uses. Ask whether there's a 5,000 W version: it usually costs less.")
    expect(oversizeTip(es, KIT, sol)).toBe(`El inversor es más del doble de lo que usa tu kit. Pregunta si hay una versión de ${fmtW(5000, 'es')}: suele bajar el precio.`)
  })
  test('there is no tip unless the inverter is oversized', () => {
    expect(oversizeTip(en, KIT, ener)).toBeNull()
    expect(oversizeTip(en, KIT, { inverter: null, battery: sol.battery })).toBeNull()
  })
  test('there is no tip when the size that still starts the kit is not smaller than the quoted one', () => {
    const kit = { ...KIT, runningW: 1000, surgeW: 7000 }
    const quoted = { have: 3000, need: 1000, ratio: 3, zone: 'over' as const, pos: 100 }
    expect(oversizeTip(en, kit, { inverter: quoted, battery: null })).toBeNull()
    expect(oversizeTip(en, kit, { inverter: { ...quoted, have: 4000, ratio: 4 }, battery: null })).toContain('3,500 W')
  })
  test('the bars read as one sentence for screen readers', () => {
    expect(sizingSentence(en, ener)).toBe('Inverter: 300 W against 3,860 W needed, short. Battery: 1.1 kWh against 8.0 kWh needed, short.')
    expect(sizingSentence(en, { inverter: null, battery: null })).toBe('')
  })
})

describe('coverageLines', () => {
  test('groups the five strip items by status, leaving out empty groups', () => {
    expect(coverageLines(en, grupoluz.items)).toEqual([
      { kind: 'ok', text: `Includes ${fmtList(['cables', 'installation'], 'en')}` },
      { kind: 'unknown', text: `Doesn't mention ${fmtList(['charger', 'Wi-Fi', 'fuse'], 'en')}` },
    ])
    expect(coverageLines(en, enerhogar.items)).toEqual([
      { kind: 'ok', text: `Includes ${fmtList(['charger', 'installation'], 'en')}` },
      { kind: 'short', text: 'Too small: cables' },
      { kind: 'missing', text: 'Not included: Wi-Fi' },
      { kind: 'unknown', text: "Doesn't mention fuse" },
    ])
  })
  test('one meta line for a card, groups joined by a middle dot', () => {
    expect(coverageMeta(en, enerhogar.items)).toBe(
      `Includes ${fmtList(['charger', 'installation'], 'en')} · Too small: cables · Not included: Wi-Fi · Doesn't mention fuse`,
    )
  })
  test('in Spanish', () => {
    expect(coverageLines(es, grupoluz.items).map((l) => l.text)).toEqual([
      `Incluye ${fmtList(['cables', 'instalación'], 'es')}`,
      `No menciona ${fmtList(['cargador', 'Wi-Fi', 'fusible'], 'es')}`,
    ])
  })
})

describe('unrankedTitle', () => {
  const u = (reason: UnrankedReason): UnrankedQuote => ({ quote: view('solartec', 0), name: 'X', reason, currency: 'USD', optionId: null, optionLabel: null, optionCount: 0 })
  test('says "without a total" only when every unranked quote waits for one', () => {
    expect(unrankedTitle(en, [u('no_total'), u('needs_review')])).toBe("Without a total, these can't be compared")
    expect(unrankedTitle(es, [u('no_total')])).toBe('Sin total, no se pueden comparar')
    expect(unrankedTitle(en, [u('no_total'), u('failed')])).toBe('Not compared yet')
    expect(unrankedTitle(es, [u('reading')])).toBe('Aún sin comparar')
  })
  test('a quote with options to check gets no total form, so it does not count as waiting for a total', () => {
    expect(unrankedTitle(en, [{ ...u('needs_review'), optionCount: 2 }])).toBe('Not compared yet')
  })
})
