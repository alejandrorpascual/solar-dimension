const BOM = '﻿'
const EOL = '\r\n'
const FALLBACK_NAME = 'kit'

export interface CsvApplianceRow { name: string; kind: string; qty: number; eachW: number; runningW: number; averageW: number; wh: number }
export interface CsvPartRow { name: string; spec: string; note: string; qty: string }

export interface CsvInput {
  appliances: CsvApplianceRow[]
  parts: CsvPartRow[]
  /** Column titles in the user's language. */
  headers: { appliances: string[]; parts: string[] }
  include: { appliances: boolean; parts: boolean }
}

/** Text starting like this runs as a formula in Excel, Sheets and LibreOffice (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One RFC 4180 cell: quoted only when it holds a comma, a quote or a line break. Text that a spreadsheet would run
 * as a formula (a custom appliance named "=HYPERLINK(…)") gets a leading apostrophe so it stays text. Numbers are ours
 * and pass as they are.
 */
export function csvCell(value: string | number): string {
  const s = typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const line = (cells: ReadonlyArray<string | number>) => cells.map(csvCell).join(',')

/**
 * The load schedule and the parts list as one spreadsheet, a blank row between them. The BOM makes Excel read the
 * file as UTF-8, so "LiFePO₄" and accented names survive.
 */
export function buildCsv(input: CsvInput): string {
  const blocks: string[][] = []
  if (input.include.appliances) {
    blocks.push([line(input.headers.appliances), ...input.appliances.map((a) => line([a.name, a.kind, a.qty, a.eachW, a.runningW, a.averageW, a.wh]))])
  }
  if (input.include.parts) {
    blocks.push([line(input.headers.parts), ...input.parts.map((p) => line([p.name, p.spec, p.note, p.qty]))])
  }
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
