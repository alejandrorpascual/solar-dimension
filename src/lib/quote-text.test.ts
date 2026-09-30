import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { compareQuotes, type QuoteView, type RankedQuote } from './quote-compare'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES, type SampleQuoteId } from './quote-fixtures'
import { checkItems, DEFAULT_MUSTS } from './quote-items'
import type { ProjectJobs } from './quote-jobs'
import {
  askText, deltaText, etaText, fitLabel, itemText, markLabel, projectLine, questionText, reasonLine, rejectionText, verdictHeading,
  verdictSubline,
} from './quote-text'

const view = (id: SampleQuoteId, i: number): QuoteView => ({
  id, fileName: `${id}.pdf`, label: null, status: 'ready', extraction: SAMPLE_QUOTES[id], overrides: {}, totalOverride: null, createdAt: i,
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

describe('row text', () => {
  test('reason lines', () => {
    expect(reasonLine(en, solartec, v, KIT)).toBe('Meets every must-have, and is the cheapest quote that does.')
    expect(reasonLine(en, voltia, v, KIT)).toBe('Also meets every must-have. Costs $820 more.')
    expect(reasonLine(en, grupoluz, v, KIT)).toBe("Doesn't mention a battery charger and a class T fuse.")
    expect(reasonLine(en, enerhogar, v, KIT)).toBe("Doesn't fit: its inverter is 3,560 W short.")
  })
  test('worth asking and the question to copy', () => {
    expect(askText(en, grupoluz, v)).toBe("Grupo Luz is $330 cheaper but doesn't mention a battery charger and a class T fuse. If the quote includes them, it becomes the best fit.")
    expect(questionText(en, grupoluz)).toBe('Hi Grupo Luz, does your quote include a battery charger and a class T fuse?')
    expect(questionText(es, grupoluz)).toBe('Hola, Grupo Luz: ¿su cotización incluye un cargador de baterías y un fusible clase T?')
  })
  test('fit labels and deltas', () => {
    expect([solartec, voltia, grupoluz, enerhogar].map((r) => fitLabel(en, r, v))).toEqual(['Best fit', 'Meets all', '2 unclear', "Doesn't fit"])
    expect(deltaText(en, voltia)).toBe('+$820 vs best')
    expect(deltaText(en, grupoluz)).toBe('−$330 vs best')
    expect(deltaText(en, solartec)).toBe('')
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

describe('status and progress text', () => {
  const jobs = (over: Partial<ProjectJobs>): ProjectJobs => ({
    projectId: 'p', projectName: 'Home', files: [], total: 4, done: 4, pending: 0, failed: 0, needsReview: 0, kitEmpty: false, unseen: false, best: null, ...over,
  })
  test('project line', () => {
    expect(projectLine(en, jobs({ done: 2, pending: 2 }))).toBe('Reading quotes 2/4')
    expect(projectLine(en, jobs({ kitEmpty: true }))).toBe('Add appliances to compare your quotes')
    expect(projectLine(es, jobs({ kitEmpty: true }))).toBe('Agrega aparatos para comparar tus cotizaciones')
    expect(projectLine(en, jobs({ best: { name: 'SolarTec Caribe', total: 6480, currency: 'USD' } }))).toBe('Verdict ready · SolarTec Caribe · $6,480')
    expect(projectLine(en, jobs({ failed: 1 }))).toBe('Check 1 of your quotes')
    expect(projectLine(en, jobs({}))).toBe('Verdict ready · none fits yet')
  })
  test('rejections carry the limit', () => {
    expect(rejectionText(en, { code: 'size', mb: 5.2 })).toBe('That file is 5.2 MB. The limit is 4 MB.')
    expect(rejectionText(en, { code: 'pages', pages: 12 })).toBe('That PDF has 12 pages. The limit is 10.')
  })
  test('ETA in seconds, then minutes', () => {
    expect(etaText(en, 45)).toBe('45 s')
    expect(etaText(en, 120)).toBe('2 min')
  })
})
