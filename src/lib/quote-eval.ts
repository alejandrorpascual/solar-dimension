// Scores one reading of a golden-set quote against the reading a person wrote for it by hand (audit AI-01; the golden
// set is A8 of docs/audits/ai-pipeline-audit.md). Pure: scripts/eval-quotes.ts calls the model and reads the files.
// With their `.ts`: that script loads this file with plain `node`, which resolves an import only as written.
import { checkExtraction, type CheckFailure } from './quote-checks.ts'
import { normalizeExtraction, type LineSpecs, type QuoteExtraction, type QuoteLine } from './quote-schema.ts'

/**
 * The field classes scored. `totals`, `lines` and `specs` are A8's: total and currency; each line's kind, qty and
 * lineTotal; the numeric specs. `details` holds every other value a document writes (vendor name, dates, subtotal, tax,
 * unit prices, optional, option, the other specs, page, options and warranties), so none goes unmeasured.
 */
export const FIELD_CLASSES = ['totals', 'lines', 'specs', 'details'] as const
export type FieldClass = (typeof FIELD_CLASSES)[number]

export const NUMERIC_SPECS = ['watts', 'surgeWatts', 'batteryVolts', 'ah', 'kWh', 'panelWatts', 'chargerAmps', 'mm2', 'fuseAmps'] as const satisfies readonly (keyof LineSpecs)[]
export const OTHER_SPECS = ['hasCharger', 'hasWifi', 'chemistry', 'awg', 'fuseClass'] as const satisfies readonly (keyof LineSpecs)[]

/** What the app's checks make of a reading. A call that brings no reading back is the runner's to count. */
export type EvalStatus = 'ready' | 'needs_review'

export interface Tally { correct: number; checked: number }
export interface FieldResult { path: string; expected: unknown; actual: unknown }

export interface ExtractionScore {
  classes: Record<FieldClass, Tally>
  /** Values the document writes that came back different, or not at all. */
  errors: FieldResult[]
  /** Fields the document leaves blank that came back with a value: A8's hallucination count. */
  hallucinations: FieldResult[]
  /** The case's unscored fields, with what came back, for a person to read. */
  recorded: FieldResult[]
  /** Expected lines that no line of the reading was paired with, by index. */
  missingLines: number[]
  /** Lines of the reading paired with no expected line, by index. */
  extraLines: number[]
}

/**
 * How a field is compared: `exact`; `text`, ignoring case and outer spaces, for a name a model may capitalise its own
 * way; `present`, only for whether it came back, for free text (a contact) whose wording can't be scored.
 */
type Compare = 'exact' | 'text' | 'present'
interface FieldCheck { path: string; cls: FieldClass; compare: Compare; expected: unknown; actual: unknown }

const check = (path: string, cls: FieldClass, expected: unknown, actual: unknown, compare: Compare = 'exact'): FieldCheck =>
  ({ path, cls, compare, expected, actual })

/** Warranties as one value to compare: kinds, years and options in a fixed order, since their order means nothing. */
const warrantyList = (x: QuoteExtraction): string =>
  x.warranties.map((w) => `${w.kind} ${w.years}${w.option === null ? '' : ` ${w.option}`}`).sort().join(', ')

function documentChecks(e: QuoteExtraction, a: QuoteExtraction): FieldCheck[] {
  return [
    check('total', 'totals', e.total, a.total),
    check('currency', 'totals', e.currency, a.currency),
    check('vendor.name', 'details', e.vendor.name, a.vendor.name, 'text'),
    check('vendor.contact', 'details', e.vendor.contact, a.vendor.contact, 'present'),
    check('date', 'details', e.date, a.date),
    check('validUntil', 'details', e.validUntil, a.validUntil),
    check('subtotal', 'details', e.subtotal, a.subtotal),
    check('tax', 'details', e.tax, a.tax),
    check('options.length', 'details', e.options.length, a.options.length),
    ...e.options.flatMap((o, i) => [
      check(`options[${i}].total`, 'details', o.total, a.options[i]?.total),
      check(`options[${i}].tax`, 'details', o.tax, a.options[i]?.tax),
    ]),
    check('warranties', 'details', warrantyList(e), warrantyList(a)),
  ]
}

/**
 * The unit price a line came back with, for a line whose document writes none: a one-unit line's amount is its unit's
 * price, so a unit price that repeats it invents nothing. A price split over several units is a division the document
 * did not write, and still counts.
 */
const unitPriceRead = (e: QuoteLine, a: QuoteLine | undefined): number | null | undefined =>
  e.unitPrice === null && a?.qty === 1 && a.unitPrice === a.lineTotal ? null : a?.unitPrice

/** The checks of one expected line against its partner in the reading, or against nothing when it was missed. */
function lineChecks(e: QuoteLine, a: QuoteLine | undefined, i: number): FieldCheck[] {
  const at = (field: string): string => `lines[${i}].${field}`
  return [
    check(at('kind'), 'lines', e.kind, a?.kind),
    check(at('qty'), 'lines', e.qty, a?.qty),
    check(at('lineTotal'), 'lines', e.lineTotal, a?.lineTotal),
    ...NUMERIC_SPECS.map((k) => check(at(`specs.${k}`), 'specs', e.specs[k], a?.specs[k])),
    ...OTHER_SPECS.map((k) => check(at(`specs.${k}`), 'details', e.specs[k], a?.specs[k])),
    check(at('unitPrice'), 'details', e.unitPrice, unitPriceRead(e, a)),
    check(at('optional'), 'details', e.optional, a?.optional),
    check(at('option'), 'details', e.option, a?.option),
    check(at('brand'), 'details', e.brand, a?.brand, 'text'),
    check(at('model'), 'details', e.model, a?.model, 'text'),
    check(at('source.page'), 'details', e.source.page, a?.source.page),
  ]
}

export interface LinePairing { pairs: { expected: number; actual: number }[]; missing: number[]; extra: number[] }

/**
 * Three passes, each over what the last left: same kind and amount, then same kind in order, then same amount in
 * order. A line read in another order still meets its partner, and one read as the wrong kind keeps it when the amount
 * agrees, so its kind is scored wrong instead of counting one missing and one extra line.
 */
const PAIRING_RULES: readonly ((e: QuoteLine, a: QuoteLine) => boolean)[] = [
  (e, a) => e.kind === a.kind && e.lineTotal === a.lineTotal,
  (e, a) => e.kind === a.kind,
  (e, a) => e.lineTotal === a.lineTotal,
]

/** Which line of the reading stands for which expected line; what is left on either side is missing or extra. */
export function pairLines(expected: readonly QuoteLine[], actual: readonly QuoteLine[]): LinePairing {
  const start: LinePairing = { pairs: [], missing: expected.map((_, i) => i), extra: actual.map((_, i) => i) }
  return PAIRING_RULES.reduce(
    (state, rule) =>
      state.missing.reduce((s, e) => {
        const a = s.extra.find((i) => rule(expected[e], actual[i]))
        if (a === undefined) return s
        return { pairs: [...s.pairs, { expected: e, actual: a }], missing: s.missing.filter((i) => i !== e), extra: s.extra.filter((i) => i !== a) }
      }, state),
    start,
  )
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a field path is one of the patterns, or inside one; `[*]` stands for any index. */
export function matchesPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => new RegExp(`^${p.split('[*]').map(escapeRegExp).join('\\[\\d+\\]')}(?:[.[]|$)`).test(path))
}

const isBlank = (v: unknown): boolean => v === null || v === undefined
const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Whether a field the document writes came back right. */
function agrees(c: FieldCheck): boolean {
  if (c.compare === 'present') return !isBlank(c.actual)
  if (c.compare === 'text' && typeof c.expected === 'string' && typeof c.actual === 'string') return sameText(c.expected, c.actual)
  return c.expected === c.actual
}

const resultOf = (c: FieldCheck): FieldResult => ({ path: c.path, expected: c.expected, actual: c.actual ?? null })

function tally(checks: readonly FieldCheck[], unscored: readonly string[]): Omit<ExtractionScore, 'missingLines' | 'extraLines'> {
  const scored = checks.filter((c) => !matchesPath(c.path, unscored))
  const written = scored.filter((c) => c.expected !== null)
  const classTally = (cls: FieldClass): Tally => {
    const own = written.filter((c) => c.cls === cls)
    return { correct: own.filter(agrees).length, checked: own.length }
  }
  return {
    classes: Object.fromEntries(FIELD_CLASSES.map((cls) => [cls, classTally(cls)])) as Record<FieldClass, Tally>,
    errors: written.filter((c) => !agrees(c)).map(resultOf),
    hallucinations: scored.filter((c) => c.expected === null && !isBlank(c.actual)).map(resultOf),
    recorded: checks.filter((c) => matchesPath(c.path, unscored)).map(resultOf),
  }
}

/** One reading against the expected one. `unscored` names fields to record only, such as one waiting on a schema change. */
export function scoreExtraction(expected: QuoteExtraction, actual: QuoteExtraction, unscored: readonly string[] = []): ExtractionScore {
  // Both as the app stores them, so option ids and the currency's case are compared the way the app ranks them.
  const e = normalizeExtraction(expected)
  const a = normalizeExtraction(actual)
  const { pairs, missing, extra } = pairLines(e.lines, a.lines)
  const partnerOf = (i: number): QuoteLine | undefined => {
    const pair = pairs.find((p) => p.expected === i)
    return pair === undefined ? undefined : a.lines[pair.actual]
  }
  const checks = [...documentChecks(e, a), ...e.lines.flatMap((l, i) => lineChecks(l, partnerOf(i), i))]
  return { ...tally(checks, unscored), missingLines: missing, extraLines: extra }
}

/** The status the app would give a reading: the same normalising and checks as process.ts. */
export function appStatus(x: QuoteExtraction): { status: EvalStatus; failures: CheckFailure[] } {
  const failures = checkExtraction(normalizeExtraction(x))
  return { status: failures.length === 0 ? 'ready' : 'needs_review', failures }
}

const DIACRITICS = /\p{Diacritic}/gu
const fold = (s: string): string => s.normalize('NFD').replace(DIACRITICS, '').toLowerCase()

/** Whether the text has the word or phrase as one of its own, so "VA" is found in "12,000 VA" but not in "nueva". */
function mentions(text: string, word: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(fold(word))}(?:$|[^\\p{L}\\p{N}])`, 'u').test(fold(text))
}

/** How many groups of words the notes mention: a group counts when the notes have any one of its words. */
export function notesTally(notes: readonly string[], groups: readonly (readonly string[])[]): Tally {
  const text = notes.join('\n')
  return { correct: groups.filter((g) => g.some((w) => mentions(text, w))).length, checked: groups.length }
}

export interface CaseExpectation {
  extraction: QuoteExtraction
  /** The status the app should give the reading; null where A8 asks only to record what happens. */
  status: EvalStatus | null
  /** Groups of words the notes must mention; each group needs one of its words. */
  notesMention: readonly (readonly string[])[]
  /** Field paths recorded but not scored. */
  unscored: readonly string[]
}

export interface CaseScore {
  fields: ExtractionScore
  status: { expected: EvalStatus | null; actual: EvalStatus; failures: CheckFailure[] }
  notes: Tally
}

export function scoreCase(expect: CaseExpectation, actual: QuoteExtraction): CaseScore {
  const app = appStatus(actual)
  return {
    fields: scoreExtraction(expect.extraction, actual, expect.unscored),
    status: { expected: expect.status, actual: app.status, failures: app.failures },
    notes: notesTally(actual.notes, expect.notesMention),
  }
}

const isFull = (t: Tally): boolean => t.correct === t.checked

/** Right in everything scored: every value, nothing invented, every line once, the status and the notes. */
export function isPerfect(s: CaseScore): boolean {
  const f = s.fields
  const isStatusRight = s.status.expected === null || s.status.expected === s.status.actual
  return FIELD_CLASSES.every((c) => isFull(f.classes[c])) && f.hallucinations.length === 0 && f.missingLines.length === 0
    && f.extraLines.length === 0 && isStatusRight && isFull(s.notes)
}

export interface ScoreSum {
  runs: number
  perfect: number
  classes: Record<FieldClass, Tally>
  hallucinations: number
  missingLines: number
  extraLines: number
  notes: Tally
  /** Runs whose status was the expected one, of the runs with an expected status. */
  status: Tally
  statuses: Record<EvalStatus, number>
}

const NO_TALLY: Tally = { correct: 0, checked: 0 }
const addTally = (a: Tally, b: Tally): Tally => ({ correct: a.correct + b.correct, checked: a.checked + b.checked })

/** Several runs added up, for a case and model or for a whole model. */
export function sumScores(scores: readonly CaseScore[]): ScoreSum {
  const sumOf = (pick: (s: CaseScore) => number): number => scores.reduce((n, s) => n + pick(s), 0)
  const tallyOf = (pick: (s: CaseScore) => Tally): Tally => scores.map(pick).reduce(addTally, NO_TALLY)
  const withStatus = scores.filter((s) => s.status.expected !== null)
  return {
    runs: scores.length,
    perfect: scores.filter(isPerfect).length,
    classes: Object.fromEntries(FIELD_CLASSES.map((c) => [c, tallyOf((s) => s.fields.classes[c])])) as Record<FieldClass, Tally>,
    hallucinations: sumOf((s) => s.fields.hallucinations.length),
    missingLines: sumOf((s) => s.fields.missingLines.length),
    extraLines: sumOf((s) => s.fields.extraLines.length),
    notes: tallyOf((s) => s.notes),
    status: { correct: withStatus.filter((s) => s.status.expected === s.status.actual).length, checked: withStatus.length },
    statuses: { ready: scores.filter((s) => s.status.actual === 'ready').length, needs_review: scores.filter((s) => s.status.actual === 'needs_review').length },
  }
}
