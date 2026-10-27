// The manifest of one golden-set case (eval/quotes/cases/<slug>/case.json), and the checks that keep it true to the
// reading written for it by hand (expected.json). Pure: eval/quotes/load-cases.ts reads the files.
// With their `.ts`: scripts/eval-quotes.ts loads this file with plain `node`, which resolves an import only as written.
import { z } from 'zod'
import { appStatus, notesTally } from './quote-eval.ts'
import type { QuoteExtraction } from './quote-schema.ts'

/** A file in eval/quotes/documents/, named without a folder, so a manifest cannot point anywhere else. */
const FileName = z.string().regex(/^[\w-]+(\.[\w-]+)+$/, 'a file name in eval/quotes/documents/, with no folder')

export const EvalCaseSchema = z.object({
  title: z.string().min(1),
  /** Where the case comes from: "A8 case 1", or the owner's own quote with its names and prices changed. */
  spec: z.string().min(1),
  document: z.object({
    /** generated: eval/quotes/build-documents.ts writes it from document.json. supplied: a person adds the file. */
    source: z.enum(['generated', 'supplied']),
    file: FileName,
    /** The file name the model is sent, as an upload's would be: neutral, so the case's own name gives nothing away. */
    uploadName: FileName,
    /** For a supplied file: how to make it. */
    howTo: z.string().optional(),
  }).strict(),
  /** The status the app should give the reading; null where A8 asks only to record what happens today. */
  status: z.enum(['ready', 'needs_review']).nullable(),
  /** The fields A8 singles out as not written, for a person to read; the scorer takes every null of expected.json. */
  expectedNull: z.array(z.string()),
  /** Fields recorded but not scored: A8 asks to record what the model writes, or the rule is still the owner's to set. */
  unscored: z.array(z.string()),
  /** Groups of words the model's notes must mention; each group needs one of its words. */
  notesMention: z.array(z.array(z.string().min(1)).min(1)),
  /** Expected values that change with a proposed fix: what is scored today and what to expect after it. */
  pending: z.array(z.object({ path: z.string(), today: z.string(), after: z.string(), change: z.string() }).strict()),
  notes: z.array(z.string()),
}).strict()
export type EvalCase = z.infer<typeof EvalCaseSchema>

/** The value at a field path such as `lines[2].specs.kWh`; `[*]` reads the first index. */
function valueAt(x: unknown, path: string): unknown {
  const keys = path.replace(/\[(\d+|\*)\]/g, (_, i: string) => `.${i === '*' ? '0' : i}`).split('.')
  return keys.reduce<unknown>((v, key) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined), x)
}

const namesNoField = (list: string, path: string): string => `${list} ${path} names no field of expected.json`

/**
 * Why a manifest disagrees with its expected reading; empty when it agrees. A path that names no field is most often
 * a typo, which would otherwise score a field that should be recorded, or record nothing. And the expected reading has
 * to pass its own case, notes included, or no reading ever could.
 */
export function caseProblems(manifest: EvalCase, expected: QuoteExtraction): string[] {
  const nulls = manifest.expectedNull.flatMap((path) => {
    const value = valueAt(expected, path)
    if (value === undefined) return [namesNoField('expectedNull', path)]
    return value === null ? [] : [`expectedNull ${path} is ${JSON.stringify(value)} in expected.json`]
  })
  const unscored = manifest.unscored.filter((path) => valueAt(expected, path) === undefined).map((path) => namesNoField('unscored', path))
  const pending = manifest.pending
    .filter((p) => p.path !== 'status' && valueAt(expected, p.path) === undefined)
    .map((p) => namesNoField('pending', p.path))
  const app = appStatus(expected)
  const status = manifest.status === null || manifest.status === app.status
    ? []
    : [`status is ${manifest.status}, but the app gives expected.json ${app.status} (${app.failures.join(', ')})`]
  const noted = notesTally(expected.notes, manifest.notesMention)
  const notes = noted.correct === noted.checked
    ? []
    : [`notesMention asks for ${noted.checked} groups, but the notes of expected.json mention ${noted.correct}`]
  return [...nulls, ...unscored, ...pending, ...status, ...notes]
}
