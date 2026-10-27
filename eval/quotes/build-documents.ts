// Writes the golden set's PDFs to eval/quotes/documents/ from each case's document.json: the clean text PDFs the model
// reads as they are (A8 cases 1, 4 to 10, 12 and the hidden-text variant of 11), and a print source (<slug>.print.pdf)
// for each case whose real file a person makes from it: a photo, a scan, an image. A photo or a scan can't be made
// honestly here without new dependencies. The PDFs are rebuilt on demand and come out byte for byte the same each time,
// so the repository holds only this generator and the case data.
//
//   npx tsx eval/quotes/build-documents.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { z } from 'zod'
import { CASES_DIR, DOCUMENTS_DIR, loadCases, type LoadedCase } from './load-cases.ts'

/** A paragraph (wrapped; "" is a blank line), a heading, or a table row: description, quantity, unit price, amount. */
const RowSchema = z.union([
  z.string(),
  z.object({ h: z.string() }).strict(),
  z.object({ cells: z.tuple([z.string(), z.string(), z.string(), z.string()]), bold: z.boolean().optional() }).strict(),
])
type Row = z.infer<typeof RowSchema>

const DocumentSpecSchema = z.object({
  /** Another case whose pages this one starts from, as A8's cases 2 and 11 start from case 1. */
  basedOn: z.string().optional(),
  pages: z.array(z.array(RowSchema).min(1)).min(1).optional(),
  /** A8 case 11, PDF: text in white at 1 pt on page 1, invisible on the page but in the text layer. */
  hiddenText: z.string().optional(),
  /** A8 case 11, image: text in pale grey at 4 pt in page 1's footer, for the print source of the image. */
  footerText: z.string().optional(),
}).strict().refine((d) => (d.basedOn === undefined) !== (d.pages === undefined), { message: 'give either basedOn or pages' })
type DocumentSpec = z.infer<typeof DocumentSpecSchema>

const PAGE = { width: 612, height: 792, margin: 54 }
const TEXT = { size: 10, heading: 13, leading: 1.4 }
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin
/** Description, quantity, unit price and amount; the last three are right-aligned, as figures are on a quote. */
const COLUMNS = [
  { x: 54, width: 248, isRight: false },
  { x: 306, width: 40, isRight: true },
  { x: 350, width: 100, isRight: true },
  { x: 454, width: 104, isRight: true },
] as const
const HIDDEN = { size: 1, color: rgb(1, 1, 1), y: 30 }
const FOOTER = { size: 4, color: rgb(0.78, 0.78, 0.78), y: 24 }
const INK = rgb(0, 0, 0)
/** Fixed, so a rebuilt PDF is the same file; pdf-lib would otherwise stamp the time it was made. */
const MADE_ON = new Date('2026-09-15T12:00:00Z')

interface Fonts { regular: PDFFont; bold: PDFFont }

function readSpec(slug: string): DocumentSpec | null {
  const path = join(CASES_DIR, slug, 'document.json')
  if (!existsSync(path)) return null
  const parsed = DocumentSpecSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) throw new Error(`${path}:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/** The pages of a spec, taken from the case it is based on when it has none of its own. */
function pagesOf(spec: DocumentSpec, slug: string): Row[][] {
  if (spec.pages) return spec.pages
  const base = spec.basedOn === undefined ? null : readSpec(spec.basedOn)
  if (!base?.pages) throw new Error(`${slug}: basedOn ${spec.basedOn} has no pages of its own`)
  return base.pages
}

/** Words laid into lines no wider than `width`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  return text.split(/\s+/).filter(Boolean).reduce<string[]>((lines, word) => {
    const last = lines.at(-1)
    const joined = last === undefined ? word : `${last} ${word}`
    if (last !== undefined && font.widthOfTextAtSize(joined, size) > width) return [...lines, word]
    return [...lines.slice(0, -1), joined]
  }, [])
}

function drawLines(page: PDFPage, lines: readonly string[], at: { x: number; y: number; width: number; isRight: boolean }, font: PDFFont, size: number): number {
  const step = size * TEXT.leading
  lines.forEach((text, i) => {
    const x = at.isRight ? at.x + at.width - font.widthOfTextAtSize(text, size) : at.x
    page.drawText(text, { x, y: at.y - i * step, size, font, color: INK })
  })
  return Math.max(1, lines.length) * step
}

/** Draws one row at `y` and returns how far down it reached. */
function drawRow(page: PDFPage, row: Row, y: number, fonts: Fonts): number {
  if (typeof row === 'string') {
    return drawLines(page, wrap(row, fonts.regular, TEXT.size, CONTENT_WIDTH), { x: PAGE.margin, y, width: CONTENT_WIDTH, isRight: false }, fonts.regular, TEXT.size)
  }
  if ('h' in row) return drawLines(page, [row.h], { x: PAGE.margin, y, width: CONTENT_WIDTH, isRight: false }, fonts.bold, TEXT.heading) + 2
  const font = row.bold ? fonts.bold : fonts.regular
  // A total row such as "Total: USD 4,300 + RD$ 35,000" writes only its first cell, across the whole width.
  const isWide = row.cells.slice(1).every((c) => c === '')
  const heights = row.cells.map((cell, i) => {
    const column = isWide && i === 0 ? { ...COLUMNS[0], width: CONTENT_WIDTH } : COLUMNS[i]
    return drawLines(page, wrap(cell, font, TEXT.size, column.width), { ...column, y }, font, TEXT.size)
  })
  return Math.max(...heights) + 3
}

function drawPage(page: PDFPage, rows: readonly Row[], fonts: Fonts, slug: string): void {
  const bottom = rows.reduce((y, row) => y - drawRow(page, row, y, fonts), PAGE.height - PAGE.margin)
  if (bottom < PAGE.margin) throw new Error(`${slug}: a page's rows run past its bottom margin; split them over two pages`)
}

function drawNote(page: PDFPage, text: string, style: { size: number; color: RGB; y: number }, font: PDFFont): void {
  page.drawText(text, { x: PAGE.margin, y: style.y, size: style.size, font, color: style.color })
}

/** The PDF for a spec. No title, author or producer: nothing in the file but the quote itself. */
async function renderPdf(spec: DocumentSpec, slug: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setCreationDate(MADE_ON)
  doc.setModificationDate(MADE_ON)
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  const pages = pagesOf(spec, slug).map((rows) => {
    const page = doc.addPage([PAGE.width, PAGE.height])
    drawPage(page, rows, fonts, slug)
    return page
  })
  if (spec.hiddenText) drawNote(pages[0], spec.hiddenText, HIDDEN, fonts.regular)
  if (spec.footerText) drawNote(pages[0], spec.footerText, FOOTER, fonts.regular)
  return doc.save()
}

/** Where a case's built PDF goes: the document itself, or the print source a person makes the document from. */
export const builtPath = (c: LoadedCase): string =>
  c.manifest.document.source === 'generated' ? c.documentPath : join(DOCUMENTS_DIR, `${c.slug}.print.pdf`)

/** Builds every case that has a document.json, and returns the paths written. */
export async function buildDocuments(cases: readonly LoadedCase[]): Promise<string[]> {
  mkdirSync(DOCUMENTS_DIR, { recursive: true })
  const built = await Promise.all(cases.map(async (c) => {
    const spec = readSpec(c.slug)
    if (!spec) {
      if (c.manifest.document.source === 'generated') throw new Error(`${c.slug}: a generated document needs a document.json`)
      return []
    }
    writeFileSync(builtPath(c), await renderPdf(spec, c.slug))
    return [builtPath(c)]
  }))
  return built.flat()
}

if (import.meta.main) {
  const written = await buildDocuments(loadCases())
  console.log(`build-documents: wrote ${written.length} PDFs to ${DOCUMENTS_DIR}`)
  for (const path of written) console.log(`  ${path.slice(DOCUMENTS_DIR.length + 1)}`)
}
