import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_QUOTES, warranty } from './quote-fixtures'
import {
  appStatus, FIELD_CLASSES, isPerfect, matchesPath, notesTally, NUMERIC_SPECS, OTHER_SPECS, pairLines, scoreCase, scoreExtraction,
  sumScores, type CaseExpectation, type ExtractionScore,
} from './quote-eval'
import type { QuoteExtraction } from './quote-schema'

const QUOTE = extraction(
  [
    line('inverter', 1150, { unitPrice: 1150, specs: { watts: 5000, surgeWatts: 10000, hasCharger: true } }),
    line('battery', 2580, { qty: 2, unitPrice: 1290, specs: { batteryVolts: 51.2, ah: 100, kWh: 5.12, chemistry: 'lifepo4' } }),
    line('wiring', 85, { specs: { awg: '2/0' } }),
    line('labor', 600),
  ],
  { vendor: { name: 'Heliandro Energía', contact: 'Tel. 809-555-0142' }, date: '2026-09-15', subtotal: 4415, tax: 0, total: 4415, warranties: [warranty('battery', 10)] },
)

const withLines = (x: QuoteExtraction, lines: QuoteExtraction['lines']): QuoteExtraction => ({ ...x, lines })
const lineAt = (x: QuoteExtraction, i: number) => x.lines[i]
const paths = (results: readonly { path: string }[]): string[] => results.map((r) => r.path)
const isFull = (s: ExtractionScore): boolean => FIELD_CLASSES.every((c) => s.classes[c].correct === s.classes[c].checked)

describe('scoreExtraction', () => {
  test('a reading equal to the expected one gets every field right and nothing else', () => {
    const score = scoreExtraction(QUOTE, QUOTE)
    expect(isFull(score)).toBe(true)
    expect(score.classes.totals).toEqual({ correct: 2, checked: 2 })
    expect(score.classes.lines).toEqual({ correct: 12, checked: 12 })
    expect(score).toMatchObject({ errors: [], hallucinations: [], recorded: [], missingLines: [], extraLines: [] })
  })
  test('scores every sample quote perfectly against itself', () => {
    for (const q of Object.values(SAMPLE_QUOTES)) expect(isFull(scoreExtraction(q, q))).toBe(true)
  })
  test('a wrong total or currency counts in totals, with what was expected and what came back', () => {
    const score = scoreExtraction(QUOTE, { ...QUOTE, total: 1, currency: 'EUR' })
    expect(score.classes.totals).toEqual({ correct: 0, checked: 2 })
    expect(score.errors).toEqual([
      { path: 'total', expected: 4415, actual: 1 },
      { path: 'currency', expected: 'USD', actual: 'EUR' },
    ])
  })
  test('a value where the document writes none is a hallucination; a value left out is an error', () => {
    const inverter = lineAt(QUOTE, 0)
    const actual = withLines(QUOTE, [{ ...inverter, specs: { ...inverter.specs, watts: null, panelWatts: 450 } }, ...QUOTE.lines.slice(1)])
    const score = scoreExtraction(QUOTE, actual)
    expect(score.hallucinations).toEqual([{ path: 'lines[0].specs.panelWatts', expected: null, actual: 450 }])
    expect(score.errors).toEqual([{ path: 'lines[0].specs.watts', expected: 5000, actual: null }])
    expect(score.classes.specs.checked - score.classes.specs.correct).toBe(1)
  })
  test('a one-unit line that repeats its amount as the unit price invents nothing; a price split over units does', () => {
    const wiring = lineAt(QUOTE, 2)
    const battery = { ...lineAt(QUOTE, 1), unitPrice: null }
    const expected = withLines(QUOTE, [lineAt(QUOTE, 0), battery, wiring, lineAt(QUOTE, 3)])
    const actual = withLines(QUOTE, [lineAt(QUOTE, 0), { ...battery, unitPrice: 1290 }, { ...wiring, unitPrice: 85 }, lineAt(QUOTE, 3)])
    expect(paths(scoreExtraction(expected, actual).hallucinations)).toEqual(['lines[1].unitPrice'])
  })
  test('free text is only checked for being there, and names ignore case', () => {
    const actual = { ...QUOTE, vendor: { name: 'HELIANDRO ENERGÍA ', contact: 'llamar al 809-555-0142' } }
    expect(isFull(scoreExtraction(QUOTE, actual))).toBe(true)
    const blank = scoreExtraction(QUOTE, { ...QUOTE, vendor: { name: 'Otra', contact: null } })
    expect(paths(blank.errors)).toEqual(['vendor.name', 'vendor.contact'])
    const invented = scoreExtraction({ ...QUOTE, vendor: { name: null, contact: null } }, QUOTE)
    expect(paths(invented.hallucinations)).toEqual(['vendor.name', 'vendor.contact'])
  })
  test('warranties are compared as a whole, in any order', () => {
    const expected = { ...QUOTE, warranties: [warranty('battery', 10), warranty('inverter', 5)] }
    expect(scoreExtraction(expected, { ...expected, warranties: [warranty('inverter', 5), warranty('battery', 10)] }).errors).toEqual([])
    expect(scoreExtraction(expected, { ...expected, warranties: [warranty('battery', 10)] }).errors).toEqual([
      { path: 'warranties', expected: 'battery 10, inverter 5', actual: 'battery 10' },
    ])
    expect(paths(scoreExtraction({ ...QUOTE, warranties: [] }, QUOTE).errors)).toEqual(['warranties'])
  })
  test('options are compared as the app stores them: ids renamed in order, a total invented for one is a hallucination', () => {
    const expected = SAMPLE_QUOTES.suna
    const renamed = {
      ...expected,
      options: expected.options.map((o, i) => ({ ...o, id: `alternativa-${i + 1}` })),
      lines: expected.lines.map((l) => ({ ...l, option: l.option === 'o1' ? 'alternativa-1' : 'alternativa-2' })),
    }
    expect(isFull(scoreExtraction(expected, renamed))).toBe(true)
    const priced = { ...expected, options: [{ ...expected.options[0], total: 2600 }, expected.options[1]] }
    expect(scoreExtraction(expected, priced).hallucinations).toEqual([{ path: 'options[0].total', expected: null, actual: 2600 }])
    expect(paths(scoreExtraction(expected, { ...expected, options: [] }).errors)).toContain('options.length')
  })
  test('a line left out is missing and its written fields count as wrong; a line added is extra', () => {
    const actual = withLines(QUOTE, [...QUOTE.lines.slice(0, 3), line('other', 811.8)])
    const score = scoreExtraction(QUOTE, actual)
    expect(score.missingLines).toEqual([3])
    expect(score.extraLines).toEqual([3])
    expect(score.classes.lines).toEqual({ correct: 9, checked: 12 })
    expect(score.hallucinations).toEqual([])
  })
  test('unscored fields are recorded with what came back, and count nowhere', () => {
    const inverter = lineAt(QUOTE, 0)
    const actual = withLines(QUOTE, [{ ...inverter, specs: { ...inverter.specs, batteryVolts: 48 } }, ...QUOTE.lines.slice(1).map((l) => ({ ...l, source: { ...l.source, page: null } }))])
    const score = scoreExtraction(QUOTE, { ...actual, currency: 'MXN' }, ['currency', 'lines[0].specs.batteryVolts', 'lines[*].source.page'])
    expect(isFull(score)).toBe(true)
    expect(score.hallucinations).toEqual([])
    expect(score.recorded).toContainEqual({ path: 'currency', expected: 'USD', actual: 'MXN' })
    expect(score.recorded).toContainEqual({ path: 'lines[0].specs.batteryVolts', expected: null, actual: 48 })
    expect(score.recorded).toContainEqual({ path: 'lines[2].source.page', expected: 1, actual: null })
  })
})

describe('pairLines', () => {
  test('lines read in another order still meet their partners', () => {
    const reversed = [...QUOTE.lines].reverse()
    expect(pairLines(QUOTE.lines, reversed)).toEqual({
      pairs: [{ expected: 0, actual: 3 }, { expected: 1, actual: 2 }, { expected: 2, actual: 1 }, { expected: 3, actual: 0 }],
      missing: [],
      extra: [],
    })
  })
  test('two lines of one kind pair by amount first, then in order', () => {
    const freight = line('other', 150)
    const discount = line('other', -197.5)
    expect(pairLines([freight, discount], [discount, freight]).pairs).toEqual([{ expected: 0, actual: 1 }, { expected: 1, actual: 0 }])
    expect(pairLines([freight, discount], [line('other', 140), line('other', -190)]).pairs).toEqual([{ expected: 0, actual: 0 }, { expected: 1, actual: 1 }])
  })
  test('a line read as the wrong kind keeps its partner when the amount agrees, so the kind is scored wrong', () => {
    const actual = withLines(QUOTE, QUOTE.lines.map((l) => (l.kind === 'wiring' ? { ...l, kind: 'other' as const } : l)))
    expect(pairLines(QUOTE.lines, actual.lines)).toMatchObject({ missing: [], extra: [] })
    expect(scoreExtraction(QUOTE, actual).errors).toEqual([{ path: 'lines[2].kind', expected: 'wiring', actual: 'other' }])
  })
  test('a line of another kind and amount is a missing line and an extra one', () => {
    expect(pairLines([line('fuse', 95)], [line('other', 811.8)])).toEqual({ pairs: [], missing: [0], extra: [0] })
  })
})

describe('matchesPath', () => {
  test('matches a path, anything inside it, and any index for [*]', () => {
    expect(matchesPath('currency', ['currency'])).toBe(true)
    expect(matchesPath('lines[2].specs.kWh', ['lines[2]'])).toBe(true)
    expect(matchesPath('options[0].total', ['options'])).toBe(true)
    expect(matchesPath('lines[12].source.page', ['lines[*].source.page'])).toBe(true)
    expect(matchesPath('lines[1].specs.kWhx', ['lines[1].specs.kWh'])).toBe(false)
    expect(matchesPath('lines[1].specs.kWh', ['lines[2].specs.kWh'])).toBe(false)
  })
})

describe('notesTally', () => {
  test('each group needs one of its words, as a word of its own, whatever the case and accents', () => {
    expect(notesTally(['El pico está en 12,000 VA.'], [['VA']])).toEqual({ correct: 1, checked: 1 })
    expect(notesTally(['Una nueva válida'], [['VA']])).toEqual({ correct: 0, checked: 1 })
    expect(notesTally(['No incluye OBRA CIVIL ni breaker'], [['breaker'], ['obra civil']])).toEqual({ correct: 2, checked: 2 })
    expect(notesTally(['En letras: cuatro mil quinientos ochenta'], [['3600', '5 kW'], ['4,580', 'cuatro mil quinientos ochenta']])).toEqual({ correct: 1, checked: 2 })
    expect(notesTally(['3,600 W según la ficha'], [['3,600']])).toEqual({ correct: 1, checked: 1 })
    expect(notesTally([], [])).toEqual({ correct: 0, checked: 0 })
  })
})

describe('appStatus', () => {
  test('ready when the checks pass, needs_review with the reasons when they do not', () => {
    expect(appStatus(QUOTE)).toEqual({ status: 'ready', failures: [] })
    expect(appStatus({ ...QUOTE, total: 0 })).toEqual({ status: 'needs_review', failures: ['no_total', 'total_mismatch'] })
  })
  test('normalises first, as the app does: a lower-case currency passes', () => {
    expect(appStatus({ ...QUOTE, currency: 'usd' }).status).toBe('ready')
  })
})

const EXPECT: CaseExpectation = { extraction: QUOTE, status: 'ready', notesMention: [], unscored: [] }

describe('scoreCase and isPerfect', () => {
  test('the expected reading is perfect', () => {
    const score = scoreCase(EXPECT, QUOTE)
    expect(score.status).toEqual({ expected: 'ready', actual: 'ready', failures: [] })
    expect(isPerfect(score)).toBe(true)
  })
  test('a status other than the expected one is not perfect; a status only recorded is never wrong', () => {
    const wrong = { ...QUOTE, warranties: [], total: 9999 }
    expect(scoreCase({ ...EXPECT, extraction: wrong }, wrong).status).toEqual({ expected: 'ready', actual: 'needs_review', failures: ['total_mismatch'] })
    expect(isPerfect(scoreCase({ ...EXPECT, extraction: wrong }, wrong))).toBe(false)
    expect(isPerfect(scoreCase({ ...EXPECT, extraction: wrong, status: null }, wrong))).toBe(true)
  })
  test('notes that miss an expected mention, a hallucination, or a missing or extra line each make it imperfect', () => {
    expect(isPerfect(scoreCase({ ...EXPECT, notesMention: [['VA']] }, QUOTE))).toBe(false)
    expect(isPerfect(scoreCase(EXPECT, { ...QUOTE, validUntil: '2026-10-15' }))).toBe(false)
    expect(isPerfect(scoreCase(EXPECT, withLines(QUOTE, [...QUOTE.lines, line('other', 0)])))).toBe(false)
    expect(isPerfect(scoreCase(EXPECT, { ...QUOTE, date: null }))).toBe(false)
  })
})

describe('sumScores', () => {
  test('adds up runs: tallies, counts, statuses, and the runs whose status was as expected', () => {
    const good = scoreCase(EXPECT, QUOTE)
    const bad = scoreCase(EXPECT, { ...withLines(QUOTE, QUOTE.lines.slice(1)), validUntil: '2026-10-15' })
    const sum = sumScores([good, bad, good])
    expect(sum).toMatchObject({ runs: 3, perfect: 2, hallucinations: 1, missingLines: 1, extraLines: 0 })
    expect(sum.classes.totals).toEqual({ correct: 6, checked: 6 })
    expect(sum.classes.lines).toEqual({ correct: 33, checked: 36 })
    expect(sum.status).toEqual({ correct: 2, checked: 3 })
    expect(sum.statuses).toEqual({ ready: 2, needs_review: 1 })
  })
  test('a status only recorded is counted but not checked; no runs add up to nothing', () => {
    const recorded = scoreCase({ ...EXPECT, status: null }, QUOTE)
    expect(sumScores([recorded]).status).toEqual({ correct: 0, checked: 0 })
    expect(sumScores([])).toMatchObject({ runs: 0, perfect: 0, statuses: { ready: 0, needs_review: 0 } })
  })
})

describe('spec lists', () => {
  test('the numeric and the other specs together are every spec a line has', () => {
    expect([...NUMERIC_SPECS, ...OTHER_SPECS].sort()).toEqual(Object.keys(line('other', 0).specs).sort())
  })
})
