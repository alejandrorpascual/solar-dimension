// What scripts/eval-quotes.ts prints: a row per case and model, a row per model, and what went wrong in the first
// imperfect run of each case and model. All of it, and more, is also in the results file.
import { FIELD_CLASSES, isPerfect, sumScores, type CaseScore, type EvalStatus, type ScoreSum, type Tally } from '../src/lib/quote-eval.ts'
import { normalizeExtraction, type QuoteExtraction } from '../src/lib/quote-schema.ts'

/** One reading of one case by one model: a scored reading, or the error that left it without a score. */
export type RunResult = { slug: string; model: string; run: number; seconds: number } & (
  | { ok: true; usage: { input: number; output: number }; score: CaseScore; extraction: QuoteExtraction }
  /** `extraction` is there when the model answered and only the scoring failed. */
  | { ok: false; error: string; extraction?: QuoteExtraction }
)

/** The runs of one case by one model, with what the case expects. */
export interface CaseModelRuns { slug: string; model: string; want: EvalStatus | null; expected: QuoteExtraction; results: RunResult[] }

/** The most differences printed per case and model; the results file has every one. */
const MAX_DIFFERENCES = 10

const scoresOf = (results: readonly RunResult[]): CaseScore[] => results.flatMap((r) => (r.ok ? [r.score] : []))
const failedOf = (results: readonly RunResult[]): number => results.filter((r) => !r.ok).length
const fraction = (t: Tally): string => `${t.correct}/${t.checked}`
const percent = (t: Tally): string => (t.checked === 0 ? '-' : `${Math.round((t.correct / t.checked) * 1000) / 10}%`)
const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v) : String(v))

/** Columns padded to their widest cell, two spaces apart. */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: readonly string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

function statusCounts(sum: ScoreSum): string {
  const parts = [`ready ${sum.statuses.ready}`, `review ${sum.statuses.needs_review}`].filter((p) => !p.endsWith(' 0'))
  return parts.length ? parts.join(', ') : '-'
}

const CASE_HEADER = ['case', 'model', 'exact', ...FIELD_CLASSES, 'halluc', 'missing', 'extra', 'notes', 'status', 'want', 'failed']

/** A row per case and model; each fraction adds up that case's runs. */
export function caseTable(entries: readonly CaseModelRuns[]): string {
  const rows = entries.map((e) => {
    const sum = sumScores(scoresOf(e.results))
    return [
      e.slug, e.model, `${sum.perfect}/${e.results.length}`, ...FIELD_CLASSES.map((c) => fraction(sum.classes[c])),
      String(sum.hallucinations), String(sum.missingLines), String(sum.extraLines), sum.notes.checked ? fraction(sum.notes) : '-',
      statusCounts(sum), e.want ?? 'record', String(failedOf(e.results)),
    ]
  })
  return table(CASE_HEADER, rows)
}

const MODEL_HEADER = ['model', 'runs', 'exact', ...FIELD_CLASSES, 'halluc', 'missing', 'extra', 'notes', 'status ok', 'failed', 'tokens in', 'tokens out']

/** A row per model: every case's runs added up, with the share right in each field class. */
export function modelTable(models: readonly string[], results: readonly RunResult[]): string {
  const rows = models.map((model) => {
    const own = results.filter((r) => r.model === model)
    const sum = sumScores(scoresOf(own))
    const tokens = (pick: (u: { input: number; output: number }) => number): string =>
      String(own.reduce((n, r) => n + (r.ok ? pick(r.usage) : 0), 0))
    return [
      model, String(own.length), `${sum.perfect}/${own.length}`, ...FIELD_CLASSES.map((c) => `${percent(sum.classes[c])} ${fraction(sum.classes[c])}`),
      String(sum.hallucinations), String(sum.missingLines), String(sum.extraLines), fraction(sum.notes), fraction(sum.status),
      String(failedOf(own)), tokens((u) => u.input), tokens((u) => u.output),
    ]
  })
  return table(MODEL_HEADER, rows)
}

const describeLine = (x: QuoteExtraction, i: number): string => {
  const l = x.lines[i]
  return l === undefined ? `line ${i}` : `line ${i} (${l.kind} ${l.lineTotal})`
}

/**
 * Each thing one scored run got wrong, one per line. A missing line is one item, not one per field it has. Lines are
 * named from the readings as the scorer saw them, normalised, since that is what its indexes count.
 */
function differences(score: CaseScore, expectedRaw: QuoteExtraction, actualRaw: QuoteExtraction): string[] {
  const expected = normalizeExtraction(expectedRaw)
  const actual = normalizeExtraction(actualRaw)
  const f = score.fields
  const s = score.status
  const isInMissingLine = (path: string): boolean => f.missingLines.some((i) => path.startsWith(`lines[${i}].`))
  const reasons = s.failures.length ? ` (${s.failures.join(', ')})` : ''
  return [
    ...f.errors.filter((e) => !isInMissingLine(e.path)).map((e) => `wrong     ${e.path}: expected ${show(e.expected)}, got ${show(e.actual)}`),
    ...f.hallucinations.map((h) => `invented  ${h.path}: ${show(h.actual)} where the document writes none`),
    ...f.missingLines.map((i) => `missing   expected ${describeLine(expected, i)}`),
    ...f.extraLines.map((i) => `extra     reading's ${describeLine(actual, i)}`),
    ...(s.expected !== null && s.expected !== s.actual ? [`status    ${s.actual}${reasons}, want ${s.expected}`] : []),
    ...(score.notes.correct < score.notes.checked ? [`notes     mention ${fraction(score.notes)} of the expected groups`] : []),
  ]
}

/** What went wrong in the first imperfect run of each case and model, and every failed call. */
export function detailBlocks(entries: readonly CaseModelRuns[]): string[] {
  return entries.flatMap((e) => {
    const failures = e.results.flatMap((r) => (r.ok ? [] : [`    run ${r.run} failed: ${r.error}`]))
    const first = e.results.find((r) => r.ok && !isPerfect(r.score))
    const found = first?.ok ? differences(first.score, e.expected, first.extraction) : []
    if (!failures.length && !found.length) return []
    const shown = found.slice(0, MAX_DIFFERENCES).map((d) => `    ${d}`)
    const more = found.length > MAX_DIFFERENCES ? [`    ... ${found.length - MAX_DIFFERENCES} more in the results file`] : []
    const counted = `${found.length} ${found.length === 1 ? 'difference' : 'differences'}`
    const title = first ? `  ${e.slug} · ${e.model} · run ${first.run}: ${counted}` : `  ${e.slug} · ${e.model}`
    return [[title, ...shown, ...more, ...failures].join('\n')]
  })
}
