const BOM = '﻿'
const EOL = '\r\n'
const FALLBACK_NAME = 'kit'

export interface CsvApplianceRow { name: string; kind: string; qty: number; eachW: number; runningW: number; averageW: number; wh: number }
export interface CsvPartRow { name: string; spec: string; note: string; qty: string }
/** A failing check or a note: what it is about, and the line that says it. */
export interface CsvAttentionRow { name: string; text: string }
/** One fact about the project for the top of the file: its label in the user's language, and its value. */
export interface CsvProjectRow { label: string; value: string }
export type CsvDelimiter = ',' | ';'

export interface CsvInput {
  /** Name, date and the like, first in the file, so a supplier with only this file knows which kit it is. */
  project?: CsvProjectRow[]
  appliances: CsvApplianceRow[]
  parts: CsvPartRow[]
  /** Failing checks and notes. They are not behind an include switch: a kit never exports without them. */
  attention: CsvAttentionRow[]
  /** Column titles in the user's language. */
  headers: { appliances: string[]; parts: string[]; attention: string[] }
  include: { appliances: boolean; parts: boolean }
  /** One closing line under everything, such as what kind of document this is. */
  footer?: string
  /** The cell separator, from `csvDelimiter`. A comma when left out. */
  delimiter?: CsvDelimiter
}

/**
 * The cell separator a spreadsheet in this browser locale expects. Where decimals take a comma ("1,5" in es-VE),
 * Excel splits CSV cells on semicolons and reads a comma-separated file as one column. A locale it cannot read gets
 * the RFC 4180 comma.
 */
export function csvDelimiter(locale: string): CsvDelimiter {
  try {
    const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value
    return decimal === ',' ? ';' : ','
  } catch {
    return ','
  }
}

/** Text starting like this runs as a formula in Excel, Sheets and LibreOffice (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One RFC 4180 cell: quoted only when it holds the delimiter in use, a quote or a line break. Text that a spreadsheet
 * would run as a formula (a custom appliance named "=HYPERLINK(…)") gets a leading apostrophe so it stays text. Numbers
 * are ours and pass as they are.
 */
export function csvCell(value: string | number, delimiter: CsvDelimiter = ','): string {
  const s = typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value)
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * The project rows, the load schedule, the parts list, whatever needs attention and the closing line as one
 * spreadsheet, a blank row between blocks. The BOM makes Excel read the file as UTF-8, so "LiFePO₄" and accented
 * names survive.
 */
export function buildCsv(input: CsvInput): string {
  const delimiter = input.delimiter ?? ','
  const line = (cells: ReadonlyArray<string | number>) => cells.map((c) => csvCell(c, delimiter)).join(delimiter)
  const blocks: string[][] = []
  if (input.project?.length) blocks.push(input.project.map((p) => line([p.label, p.value])))
  if (input.include.appliances) {
    blocks.push([line(input.headers.appliances), ...input.appliances.map((a) => line([a.name, a.kind, a.qty, a.eachW, a.runningW, a.averageW, a.wh]))])
  }
  if (input.include.parts) {
    blocks.push([line(input.headers.parts), ...input.parts.map((p) => line([p.name, p.spec, p.note, p.qty]))])
  }
  if (input.attention.length > 0) {
    blocks.push([line(input.headers.attention), ...input.attention.map((a) => line([a.name, a.text]))])
  }
  if (input.footer) blocks.push([line([input.footer])])
  return BOM + blocks.map((b) => b.join(EOL)).join(EOL + EOL)
}

/** "<project>-kit.<ext>", keeping letters (any language), digits, dashes and underscores. */
export function exportFileName(projectName: string, ext: string): string {
  const base = projectName
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
  return base ? `${base}-${FALLBACK_NAME}.${ext}` : `${FALLBACK_NAME}.${ext}`
}
