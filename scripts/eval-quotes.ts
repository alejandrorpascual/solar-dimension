// `npm run eval:quotes`: reads the golden-set quotes of eval/quotes with the models the app is configured with, a few
// times each, sending the very request the app sends, and scores every reading against the one written by hand (audit
// AI-01). Every call is paid, so it is run by hand only: it refuses to run in CI, and without --yes it prints the calls
// it would make and makes none.
//
//   npx tsx scripts/eval-quotes.ts                    the plan: how many calls, to which models; calls nothing
//   npx tsx scripts/eval-quotes.ts --yes              the run; OPENAI_API_KEY comes from the shell, never from a file
//   npx tsx scripts/eval-quotes.ts --dry-run --yes    the whole run with two fake models instead, free
//   --model <id>     only that one of the configured models     --case <slug or number>   only that case
//   --runs <n>       readings per case and model (3: no temperature is set, so readings vary)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { buildDocuments } from '../eval/quotes/build-documents.ts'
import { DOCUMENTS_DIR, expectationOf, loadCases, RESULTS_DIR, type LoadedCase } from '../eval/quotes/load-cases.ts'
import { pdfInfo } from '../src/lib/pdf-info.ts'
import { scoreCase, sumScores } from '../src/lib/quote-eval.ts'
import { line } from '../src/lib/quote-fixtures.ts'
import { MAX_MB, QUOTE_LIMITS, sniffMime, toMb, type QuoteMime } from '../src/lib/quote-limits.ts'
import type { QuoteExtraction } from '../src/lib/quote-schema.ts'
import {
  classifyError, extractRequest, MAX_OUTPUT_TOKENS, modelNames, openAiModel, SYSTEM_PROMPT, type ModelInput, type ModelOutput, type QuoteModel,
} from '../src/server/quotes/model.ts'
import { caseTable, detailBlocks, modelTable, type CaseModelRuns, type RunResult } from './eval-quotes-table.ts'

const COMMAND = 'eval:quotes'
/** A8: three runs per case and model, since no temperature is set. */
const DEFAULT_RUNS = 3
const MAX_RUNS = 10
/** Calls in flight at once on a real run: a 66-call run takes minutes instead of most of an hour, well under rate limits. */
const CONCURRENT_CALLS = 3
const FAKE_MODELS = ['fake-expected', 'fake-wrong'] as const
const CLI_OPTIONS = {
  yes: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, model: { type: 'string' }, case: { type: 'string' }, runs: { type: 'string' },
} as const

function fail(message: string): never {
  console.error(`${COMMAND} failed: ${message}`)
  process.exit(1)
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const shown = (path: string): string => relative(process.cwd(), path) || '.'
const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

interface Options { isConfirmed: boolean; isDryRun: boolean; model: string | null; caseFilter: string | null; runs: number }

/** The arguments; an unknown one stops the run, so a mistyped flag can't pass for no flag. */
function parseCli() {
  try {
    return parseArgs({ options: CLI_OPTIONS }).values
  } catch (error) {
    return fail(`${messageOf(error)}. It takes --yes, --dry-run, --model <id>, --case <slug or number> and --runs <n>.`)
  }
}

function readOptions(): Options {
  const values = parseCli()
  const runs = Number(values.runs ?? DEFAULT_RUNS)
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) fail(`--runs takes a whole number from 1 to ${MAX_RUNS}.`)
  return { isConfirmed: values.yes === true, isDryRun: values['dry-run'] === true, model: values.model ?? null, caseFilter: values.case ?? null, runs }
}

function loadOrFail(): LoadedCase[] {
  try {
    return loadCases()
  } catch (error) {
    return fail(messageOf(error))
  }
}

function selectCases(filter: string | null): LoadedCase[] {
  const cases = loadOrFail()
  if (filter === null) return cases
  // The folders are numbered 01 to 12, so `--case 4` means 04.
  const key = /^\d+$/.test(filter) ? filter.padStart(2, '0') : filter
  const picked = cases.filter((c) => c.slug === key || c.slug.startsWith(`${key}-`))
  if (!picked.length) fail(`--case ${filter} matches no case. The cases are: ${cases.map((c) => c.slug).join(', ')}.`)
  return picked
}

/** The models to call: the app's two (from the shell, with model.ts's defaults), or the two fakes of a dry run. */
function modelsToRun(options: Options): string[] {
  const configured = options.isDryRun ? [...FAKE_MODELS] : [...new Set(Object.values(modelNames()))]
  if (options.model === null) return configured
  if (!configured.includes(options.model)) {
    fail(`--model ${options.model} is not one of ${configured.join(', ')}. To try another model, set QUOTES_MODEL_PRIMARY or QUOTES_MODEL_FALLBACK in the shell for this run.`)
  }
  return [options.model]
}

/** The app's own upload checks (checkBasics, inspectUpload): a file the app would refuse is never read, so not scored either. */
async function uploadCheck(bytes: Uint8Array): Promise<{ mime: QuoteMime } | { problem: string }> {
  if (bytes.byteLength > QUOTE_LIMITS.maxBytes) return { problem: `it is ${toMb(bytes.byteLength)} MB, over the app's ${MAX_MB} MB` }
  const mime = sniffMime(bytes)
  if (!mime) return { problem: 'it is not a PDF, JPEG, PNG or WebP file' }
  if (mime !== 'application/pdf') return { mime }
  const info = await pdfInfo(bytes)
  if (!info.ok) return { problem: `the PDF is ${info.reason}` }
  return info.pages > QUOTE_LIMITS.maxPages ? { problem: `it has ${info.pages} pages, over the app's ${QUOTE_LIMITS.maxPages}` } : { mime }
}

interface Ready { case: LoadedCase; input: ModelInput }
type Prepared = { ok: true; ready: Ready } | { ok: false; slug: string; reason: string }

async function prepare(c: LoadedCase): Promise<Prepared> {
  const file = shown(c.documentPath)
  if (!existsSync(c.documentPath)) {
    const why = c.manifest.document.source === 'supplied' ? 'it is made by hand; see howTo in its case.json' : 'build-documents.ts did not write it'
    return { ok: false, slug: c.slug, reason: `${file} is missing: ${why}` }
  }
  const bytes = new Uint8Array(readFileSync(c.documentPath))
  const checked = await uploadCheck(bytes)
  if ('problem' in checked) return { ok: false, slug: c.slug, reason: `the app would refuse ${file}: ${checked.problem}` }
  return { ok: true, ready: { case: c, input: { bytes, mime: checked.mime, fileName: c.manifest.document.uploadName } } }
}

/**
 * A reading wrong in each way the scorer counts, for the dry run: a total of 1.00 and a 400 A fuse added, as A8 case
 * 11's hidden text asks for, a panel rating no quote writes (a hallucination), and the last line left out.
 */
function wrongReading(x: QuoteExtraction): QuoteExtraction {
  const [first, ...rest] = x.lines
  if (first === undefined) return { ...x, total: 1 }
  const invented = line('fuse', 400, { description: 'Fusible clase T 400 A', source: { page: 1, text: 'Fusible clase T 400 A' }, specs: { fuseAmps: 400, fuseClass: 'T' } })
  return { ...x, total: 1, lines: [{ ...first, specs: { ...first.specs, panelWatts: 450 } }, ...rest.slice(0, -1), invented] }
}

/**
 * The dry run's model. It builds the very request a real run sends, so a dry run proves that request can be built here,
 * and answers without sending it: `fake-expected` with the case's expected reading, `fake-wrong` with a wrong one.
 */
function fakeModel(expected: QuoteExtraction): QuoteModel {
  return {
    async extract(input, model) {
      extractRequest(input, model)
      return { extraction: model === 'fake-wrong' ? wrongReading(expected) : expected, input: 0, output: 0 }
    },
  }
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) fail('OPENAI_API_KEY is not set. Export it in this shell for the run: this script never reads .env.local or any other file for it.')
  return key
}

interface Job { ready: Ready; model: string; run: number }

async function callModel(job: Job, model: QuoteModel): Promise<{ ok: true; out: ModelOutput } | { ok: false; error: string }> {
  try {
    return { ok: true, out: await model.extract(job.ready.input, job.model) }
  } catch (error) {
    const e = classifyError(error)
    return { ok: false, error: `${e.kind}: ${e.message}` }
  }
}

async function readOnce(job: Job, model: QuoteModel): Promise<RunResult> {
  const started = performance.now()
  const base = { slug: job.ready.case.slug, model: job.model, run: job.run }
  const seconds = (): number => Math.round((performance.now() - started) / 100) / 10
  const call = await callModel(job, model)
  if (!call.ok) return { ...base, seconds: seconds(), ok: false, error: call.error }
  const { extraction, input, output } = call.out
  try {
    const score = scoreCase(expectationOf(job.ready.case), extraction)
    return { ...base, seconds: seconds(), ok: true, usage: { input, output }, score, extraction }
  } catch (error) {
    // A reading the scorer can't take is a bug here, not a failure of the model's, and the paid reading is kept.
    return { ...base, seconds: seconds(), ok: false, error: `scoring failed: ${messageOf(error)}`, extraction }
  }
}

/** Runs `work` over the items, `size` at a time, keeping their order. */
async function inPool<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await work(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return results
}

async function runJobs(jobs: readonly Job[], options: Options): Promise<RunResult[]> {
  const real = options.isDryRun ? null : openAiModel(apiKey())
  let done = 0
  return inPool(jobs, options.isDryRun ? jobs.length : CONCURRENT_CALLS, async (job) => {
    const result = await readOnce(job, real ?? fakeModel(job.ready.case.expected))
    done += 1
    if (!options.isDryRun) {
      const outcome = result.ok ? 'read' : result.error
      console.log(`  [${done}/${jobs.length}] ${job.ready.case.slug} · ${job.model} · run ${job.run}: ${outcome} (${result.seconds} s)`)
    }
    return result
  })
}

function printPlan(ready: readonly Ready[], models: readonly string[], options: Options, calls: number): void {
  const kind = options.isDryRun ? 'fake calls (dry run: nothing is sent, nothing is paid)' : 'model calls'
  console.log(`${COMMAND} plan: ${count(ready.length, 'case')} x ${count(models.length, 'model')} x ${count(options.runs, 'run')} = ${calls} ${kind}`)
  console.log(`  models: ${models.join(', ')}`)
  if (options.isDryRun) return
  console.log(`  each call sends one document and may write up to ${MAX_OUTPUT_TOKENS.toLocaleString('en-US')} output tokens; the results file keeps each call's tokens`)
  if (!process.env.OPENAI_API_KEY) console.log('  OPENAI_API_KEY is not set in this shell; a run needs it')
}

function stopAtPlan(calls: number, options: Options): void {
  // A dry run's plan points to the dry run, so a copied command never turns it into a paid one.
  const flags = options.isDryRun ? '--dry-run --yes' : '--yes'
  const what = options.isDryRun ? `these ${calls} fake calls, free` : `these ${calls} calls`
  console.log(`Nothing was called. To make ${what}: npx tsx scripts/eval-quotes.ts ${flags} (or npm run ${COMMAND} -- ${flags})`)
  // `npm run eval:quotes --yes`, without the `--`, never hands the flag on: npm keeps it as a setting of its own.
  if (process.env.npm_config_yes !== undefined || process.env.npm_config_dry_run !== undefined) {
    console.log(`npm kept --yes or --dry-run for itself; pass them after a --: npm run ${COMMAND} -- --dry-run --yes`)
  }
}

/** The commit the prompt and schema came from, marked when the checkout has changes: a baseline is only as good as this. */
function commitOf(): string | null {
  const git = spawnSync('git', ['describe', '--always', '--dirty'], { encoding: 'utf8' })
  return git.status === 0 ? git.stdout.trim() : null
}

function entriesOf(ready: readonly Ready[], models: readonly string[], results: readonly RunResult[]): CaseModelRuns[] {
  return ready.flatMap((r) => models.map((model) => ({
    slug: r.case.slug, model, want: r.case.manifest.status, expected: r.case.expected,
    results: results.filter((x) => x.slug === r.case.slug && x.model === model),
  })))
}

interface Report {
  startedAt: string; options: Options; models: string[]; ready: Ready[]; skipped: { slug: string; reason: string }[]; results: RunResult[]
}

function writeResults(report: Report): string {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const stamp = report.startedAt.replace(/[:.]/g, '-')
  const path = join(RESULTS_DIR, `${stamp}${report.options.isDryRun ? '-dry-run' : ''}.json`)
  const summary = Object.fromEntries(report.models.map((m) => [m, sumScores(report.results.flatMap((r) => (r.model === m && r.ok ? [r.score] : [])))]))
  const body = {
    command: COMMAND, startedAt: report.startedAt, finishedAt: new Date().toISOString(), isDryRun: report.options.isDryRun,
    commit: commitOf(), prompt: { characters: SYSTEM_PROMPT.length, maxOutputTokens: MAX_OUTPUT_TOKENS },
    models: report.models, runs: report.options.runs, cases: report.ready.map((r) => r.case.slug), skipped: report.skipped,
    summary, results: report.results,
  }
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`)
  return path
}

function printReport(report: Report): void {
  const entries = entriesOf(report.ready, report.models, report.results)
  console.log(`\n${caseTable(entries)}\n\n${modelTable(report.models, report.results)}`)
  const details = detailBlocks(entries)
  if (details.length) console.log(`\nWhat went wrong, in the first imperfect run of each case and model:\n${details.join('\n')}`)
  console.log(`\nResults: ${shown(writeResults(report))}`)
}

async function main(): Promise<void> {
  if (process.env.CI !== undefined) {
    console.error(`${COMMAND} refused: CI is set. This evaluation calls a paid API and is run by hand only, never in CI (audit AI-01).`)
    process.exit(1)
  }
  const startedAt = new Date().toISOString()
  const options = readOptions()
  const models = modelsToRun(options)
  const cases = selectCases(options.caseFilter)
  const built = await buildDocuments(cases)
  console.log(`${COMMAND}: built ${count(built.length, 'PDF')} in ${shown(DOCUMENTS_DIR)}`)
  const prepared = await Promise.all(cases.map(prepare))
  const ready = prepared.flatMap((p) => (p.ok ? [p.ready] : []))
  const skipped = prepared.flatMap((p) => (p.ok ? [] : [{ slug: p.slug, reason: p.reason }]))
  for (const s of skipped) console.log(`  skipped ${s.slug}: ${s.reason}`)
  const jobs = ready.flatMap((r) => models.flatMap((model) => Array.from({ length: options.runs }, (_, i) => ({ ready: r, model, run: i + 1 }))))
  if (!jobs.length) fail('no case has a document to read.')
  printPlan(ready, models, options, jobs.length)
  if (!options.isConfirmed) return stopAtPlan(jobs.length, options)
  const results = await runJobs(jobs, options)
  printReport({ startedAt, options, models, ready, skipped, results })
}

await main()
