// Feasibility spike: can a model with web search find 4 inverters and 4 batteries that fit a sized kit, with specs
// we can trust, and what does one search cost? Nothing is stored; the app is untouched.
//
//   npx tsx scripts/product-search/spike.ts --dry                                    print the kit and the prompt only
//   npx tsx --env-file=<file with OPENAI_API_KEY> scripts/product-search/spike.ts    one real search (billed)
//   npx tsx scripts/product-search/spike.ts --from=<saved.json>                      re-grade a saved run (free)
//
// Options: --model=gpt-6-luna|gpt-6-sol  --country=VE  --context=low|medium|high  --effort=low|medium|high  --out=<file.json>
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { Response } from 'openai/resources/responses/responses'
import { costOf, countSearchCalls, searchSources, TOKEN_PRICES } from './cost'
import { checkLinks } from './links'
import { spikeNeeds, type ProductNeeds } from './needs'
import { printCost, printFeasibility, printNeeds, printProducts } from './report'
import { INSTRUCTIONS, ProductSearchSchema, searchRequestText, type ProductSearch } from './schema'

const REQUEST_TIMEOUT_MS = 10 * 60_000
/** Reasoning tokens count against this too; a search that reads many pages reasons a lot. */
const MAX_OUTPUT_TOKENS = 40_000
const LEVELS = ['low', 'medium', 'high'] as const
type Level = (typeof LEVELS)[number]

function parseLevel(name: string, value: string | undefined): Level | undefined {
  if (value === undefined) return undefined
  if (!(LEVELS as readonly string[]).includes(value)) throw new Error(`--${name} must be one of ${LEVELS.join(', ')}`)
  return value as Level
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      dry: { type: 'boolean', default: false },
      model: { type: 'string', default: 'gpt-6-luna' },
      country: { type: 'string', default: 'VE' },
      context: { type: 'string' },
      effort: { type: 'string' },
      out: { type: 'string' },
      from: { type: 'string' },
    },
  })
  const country = values.country.toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('--country must be a two-letter ISO code, e.g. VE or US')
  if (!TOKEN_PRICES[values.model]) throw new Error(`--model must be one of ${Object.keys(TOKEN_PRICES).join(', ')}`)
  return {
    isDry: values.dry, model: values.model, country, out: values.out, from: values.from,
    context: parseLevel('context', values.context), effort: parseLevel('effort', values.effort),
  }
}
type Options = ReturnType<typeof readOptions>

/** One search's answer, live or replayed from a saved file. */
interface Run {
  model: string; seconds: number; status: string | undefined; incompleteReason: string | null
  output: Response['output']; usage: Response['usage'] | null; found: ProductSearch | null
}

async function search(opts: Options, input: string): Promise<Run> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set. Pass --env-file=<file> to tsx, or use --dry.')
  const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 })
  console.log(`Searching with ${opts.model} (country ${opts.country})… this can take a few minutes.\n`)
  const started = performance.now()
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(0)} s`
  // Streamed, so bytes keep flowing while the model searches: one silent multi-minute request was dropped mid-wait.
  const stream = client.responses.stream({
    model: opts.model,
    instructions: INSTRUCTIONS,
    input,
    tools: [{ type: 'web_search', user_location: { type: 'approximate', country: opts.country }, ...(opts.context ? { search_context_size: opts.context } : {}) }],
    include: ['web_search_call.action.sources'],
    text: { format: zodTextFormat(ProductSearchSchema, 'products') },
    ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
  })
  let searches = 0
  stream.on('response.web_search_call.completed', () => {
    searches += 1
    console.log(`  [${elapsed()}] web search call ${searches} done`)
  })
  const res = await stream.finalResponse().catch((error: unknown) => {
    throw new Error(`failed after ${elapsed()} and ${searches} search calls: ${describe(error)}`)
  })
  console.log()
  return {
    model: opts.model, seconds: (performance.now() - started) / 1000, status: res.status,
    incompleteReason: res.incomplete_details?.reason ?? null, output: res.output, usage: res.usage ?? null, found: res.output_parsed,
  }
}

type Raw = Record<string, unknown>
interface OldSpec { value: number | null; source: string | null }
const OLD_SURGE_KEYS = new Set(['surgeW', 'surgeSeconds'])

/** An inverter saved before surge levels existed: its single surge rating becomes one level. */
function upgradeInverter(p: Raw): Raw {
  if (p.surges !== undefined) return p
  const surgeW = p.surgeW as OldSpec | undefined
  const surgeSeconds = p.surgeSeconds as OldSpec | undefined
  const rest = Object.fromEntries(Object.entries(p).filter(([k]) => !OLD_SURGE_KEYS.has(k)))
  if (surgeW?.value == null) return { ...rest, surges: [] }
  const level = { w: surgeW.value, seconds: surgeSeconds?.value ?? null, asWritten: 'single rating (older run)', source: surgeW.source ?? '' }
  return { ...rest, surges: [level] }
}

/** The structured answer in a saved response. Runs saved before extraSpecs or surge levels existed are read in the new shape. */
function parseSavedAnswer(output: Response['output']): ProductSearch | null {
  const text = output.flatMap((o) => (o.type === 'message' ? o.content : [])).find((c) => c.type === 'output_text')
  if (!text || text.type !== 'output_text') return null
  const raw = JSON.parse(text.text) as { inverters?: Raw[]; batteries?: Raw[] }
  const withExtras = (ps: Raw[] = []): Raw[] => ps.map((p) => ({ extraSpecs: [], ...p }))
  return ProductSearchSchema.parse({ ...raw, inverters: withExtras(raw.inverters).map(upgradeInverter), batteries: withExtras(raw.batteries) })
}

async function replay(path: string): Promise<Run> {
  const saved = JSON.parse(await readFile(path, 'utf8')) as {
    opts: { model: string }; seconds?: number; status?: string; usage: Response['usage']; output: Response['output']
  }
  console.log(`Re-grading ${path} (no API call).\n`)
  return {
    model: saved.opts.model, seconds: saved.seconds ?? 0, status: saved.status, incompleteReason: null,
    output: saved.output, usage: saved.usage ?? null, found: parseSavedAnswer(saved.output),
  }
}

async function report(run: Run, needs: ProductNeeds) {
  const calls = countSearchCalls(run)
  if (!run.found) {
    console.log(`No parsed answer (status ${run.status}${run.incompleteReason ? `, ${run.incompleteReason}` : ''}).`)
  } else {
    const urls = [...run.found.inverters, ...run.found.batteries].flatMap((p) => [p.productUrl, ...(p.datasheetUrl ? [p.datasheetUrl] : [])])
    const links = await checkLinks(urls, searchSources(run))
    printProducts(run.found, needs, new Map(links.map((l) => [l.url, l])))
    printFeasibility(run.found, needs, links)
  }
  if (run.usage) printCost(run.model, run.seconds, calls, costOf(run.model, run.usage, calls))
}

async function main() {
  const opts = readOptions()
  const { needs } = spikeNeeds()
  const input = searchRequestText(needs, opts.country)
  printNeeds(needs)
  if (opts.isDry) {
    console.log(`INSTRUCTIONS\n${INSTRUCTIONS}\n\nINPUT\n${input}`)
    return
  }
  const run = opts.from ? await replay(opts.from) : await search(opts, input)
  if (opts.out && !opts.from) {
    const { model, seconds, status, usage, output } = run
    await writeFile(opts.out, JSON.stringify({ opts: { ...opts, model }, needs, seconds, status, usage, output }, null, 2))
  }
  await report(run, needs)
  if (opts.out && !opts.from) console.log(`\nRaw response written to ${opts.out}`)
}

/** The error and its causes, e.g. "APIConnectionError: Connection error. ← TypeError: terminated ← SocketError: other side closed". */
function describe(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  while (current instanceof Error && parts.length < 5) {
    const code = (current as { code?: unknown }).code
    parts.push(`${current.name}: ${current.message}${typeof code === 'string' ? ` (${code})` : ''}`)
    current = current.cause
  }
  return parts.length > 0 ? parts.join(' ← ') : String(error)
}

main().catch((error: unknown) => {
  console.error(describe(error))
  process.exitCode = 1
})
