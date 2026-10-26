// Measures the role the live model tags on each wiring line of real quote files, beside the role expected for it.
// Billed: one primary-model call per file. Nothing is stored; the app is untouched.
//
//   npx tsx --env-file=<file with OPENAI_API_KEY> scripts/quote-roles.ts <folder>
//
// The folder holds the quote files (PDF or image) and an expected.json written by hand before the run:
//   { "quote-a.pdf": [{ "text": "Acometida eléctrica 4/0 AWG", "role": "ac" }, { "text": "Cable 6 AWG baterías", "role": "battery" }] }
// `text` is a piece of the line's words (description or source text, any case); `role` is one of LINE_ROLES, or null
// when the document doesn't say what the line connects. Options: --model=<name> (default QUOTES_MODEL_PRIMARY).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { sniffMime } from '../src/lib/quote-limits.ts'
import { LINE_ROLES, normalizeExtraction, type QuoteLine } from '../src/lib/quote-schema.ts'
import { modelNames, openAiModel } from '../src/server/quotes/model.ts'

const ExpectedSchema = z.record(z.string(), z.array(z.object({ text: z.string().min(1), role: z.enum(LINE_ROLES).nullable() })))
type Expected = z.infer<typeof ExpectedSchema>[string][number]
/** The role column for a line the model read with no role, or a line it never read. */
const NO_ROLE = 'null'
const NOT_READ = 'not read'

const hasText = (l: QuoteLine, text: string): boolean =>
  `${l.description} ${l.source.text}`.toLowerCase().includes(text.toLowerCase())

/** One row per expected line: the wiring line whose words hold its text, and the role the model gave it. */
function rowsFor(file: string, wiring: readonly QuoteLine[], expected: readonly Expected[]) {
  return expected.map((e) => {
    const read = wiring.find((l) => hasText(l, e.text))
    const got = read === undefined ? NOT_READ : read.role ?? NO_ROLE
    const want = e.role ?? NO_ROLE
    return { file, text: e.text, want, got, isRight: got === want }
  })
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { model: { type: 'string' } } })
  const folder = positionals[0]
  if (!folder) throw new Error('Usage: scripts/quote-roles.ts <folder with the quote files and expected.json>')
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set. Pass --env-file=<file> to tsx.')
  const expected = ExpectedSchema.parse(JSON.parse(await readFile(join(folder, 'expected.json'), 'utf8')))
  const model = values.model ?? modelNames().primary
  const reader = openAiModel(apiKey)

  const rows: ReturnType<typeof rowsFor> = []
  for (const [fileName, lines] of Object.entries(expected)) {
    const bytes = new Uint8Array(await readFile(join(folder, fileName)))
    const mime = sniffMime(bytes)
    if (mime === null) throw new Error(`${fileName} is not a PDF, JPEG, PNG or WebP file`)
    const { extraction } = await reader.extract({ bytes, mime, fileName }, model)
    const wiring = normalizeExtraction(extraction).lines.filter((l) => l.kind === 'wiring')
    rows.push(...rowsFor(fileName, wiring, lines))
    // Wiring lines no expected entry names, so a missing entry is seen rather than skipped.
    for (const l of wiring.filter((w) => !lines.some((e) => hasText(w, e.text)))) {
      console.log(`unlisted  ${fileName}  "${l.description}"  tag=${l.role ?? NO_ROLE}`)
    }
  }

  console.table(rows.map(({ isRight, ...r }) => ({ ...r, ok: isRight ? '✓' : '✗' })))
  console.log(`model ${model} · ${rows.filter((r) => r.isRight).length}/${rows.length} right`)
  for (const role of [...LINE_ROLES, NO_ROLE]) {
    const of = rows.filter((r) => r.want === role)
    if (of.length > 0) console.log(`${role}: ${of.filter((r) => r.isRight).length}/${of.length} right`)
  }
}

await main()
