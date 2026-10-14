// Reads the golden set: every folder of eval/quotes/cases/ that has a case.json, with its expected.json, each checked
// against its schema and the two against each other. One bad case stops everything, before any document is built or
// any model is called, with every problem listed. Used by build-documents.ts, scripts/eval-quotes.ts and the tests.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { caseProblems, EvalCaseSchema, type EvalCase } from '../../src/lib/quote-eval-case.ts'
import type { CaseExpectation } from '../../src/lib/quote-eval.ts'
import { QuoteExtractionSchema, type QuoteExtraction } from '../../src/lib/quote-schema.ts'

export const EVAL_DIR = fileURLToPath(new URL('.', import.meta.url))
export const CASES_DIR = join(EVAL_DIR, 'cases')
/** Built and supplied documents; gitignored, since the PDFs are rebuilt on demand and a supplied file may be private. */
export const DOCUMENTS_DIR = join(EVAL_DIR, 'documents')
export const RESULTS_DIR = join(EVAL_DIR, 'results')

export interface LoadedCase {
  slug: string
  dir: string
  manifest: EvalCase
  expected: QuoteExtraction
  /** Where the document the model reads is, or would be once it is built or supplied. */
  documentPath: string
}

type Loaded = { ok: true; value: LoadedCase } | { ok: false; problems: string[] }

function readJson<T>(path: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; problem: string } {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problem: `${path}:\n${z.prettifyError(parsed.error)}` }
  } catch (error) {
    return { ok: false, problem: `${path}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function loadCase(slug: string): Loaded {
  const dir = join(CASES_DIR, slug)
  const manifest = readJson(join(dir, 'case.json'), EvalCaseSchema)
  const expected = readJson(join(dir, 'expected.json'), QuoteExtractionSchema)
  if (!manifest.ok || !expected.ok) return { ok: false, problems: [manifest, expected].flatMap((r) => (r.ok ? [] : [r.problem])) }
  const problems = caseProblems(manifest.value, expected.value)
  if (problems.length) return { ok: false, problems: problems.map((p) => `${slug}: ${p}`) }
  return { ok: true, value: { slug, dir, manifest: manifest.value, expected: expected.value, documentPath: join(DOCUMENTS_DIR, manifest.value.document.file) } }
}

/** Every case, in folder order; throws with every problem found when any case is not valid. */
export function loadCases(): LoadedCase[] {
  const slugs = readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CASES_DIR, d.name, 'case.json')))
    .map((d) => d.name)
    .sort()
  const loaded = slugs.map(loadCase)
  const problems = loaded.flatMap((l) => (l.ok ? [] : l.problems))
  if (problems.length) throw new Error(`the golden set has problems:\n${problems.join('\n')}`)
  return loaded.flatMap((l) => (l.ok ? [l.value] : []))
}

/** What the scorer needs from a case. */
export const expectationOf = (c: LoadedCase): CaseExpectation => ({
  extraction: c.expected, status: c.manifest.status, notesMention: c.manifest.notesMention, unscored: c.manifest.unscored,
})
