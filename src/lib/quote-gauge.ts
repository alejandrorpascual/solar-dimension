import { GAUGES, type Gauge } from './catalog'

/** A cable size read from a quote: its copper area and how to print it. */
export interface CableSize { mm2: number; label: string }

/** A quoted size within this share of a table gauge's area counts as that gauge (70 mm² is 2/0, 66 mm² still is). */
export const MM2_TOLERANCE = 0.95
/** mm² per kcmil (a thousand circular mils). */
const MM2_PER_KCMIL = 0.5067
/** The AWG formula: diameter 0.127 mm × 92^((36 − n) / 39). */
const AWG_BASE_MM = 0.127
const AWG_RATIO = 92
const AWG_ZERO = 36
const AWG_STEPS = 39
const THINNEST_AWG = 40
/** "0", "00", "000" and "0000" are another way to write 1/0 to 4/0. */
const ZEROS: Readonly<Record<string, string>> = { '0': '1/0', '00': '2/0', '000': '3/0', '0000': '4/0' }

const KCMIL = /^(\d+(?:[.,]\d+)?)\s*(?:KCMIL|MCM)\b/
const MM2 = /^(\d+(?:[.,]\d+)?)\s*MM(?:2|²)/
/** A gauge at the start, followed by anything but another digit or slash: "2/0", "2 AWG THHN", "1/0AWG". */
const AWG = /^(\d\/0|0{1,4}|\d{1,2})(?![\d/])/

const decimal = (s: string): number => Number(s.replace(',', '.'))

/** The area of an AWG gauge the table doesn't list, from the standard formula. */
function awgMm2(n: number): number {
  const d = AWG_BASE_MM * AWG_RATIO ** ((AWG_ZERO - n) / AWG_STEPS)
  return (Math.PI / 4) * d * d
}

function readAwg(token: string): CableSize | null {
  const key = ZEROS[token] ?? token
  const label = `${key} AWG`
  const listed = GAUGES.find((g) => g.awg === label)
  if (listed) return { mm2: listed.mm2, label }
  const n = Number(key)
  return Number.isInteger(n) && n >= 1 && n <= THINNEST_AWG ? { mm2: awgMm2(n), label } : null
}

/**
 * A size written as AWG ("2/0", "2/0 AWG", "#4", "00", "2 AWG THHN"), kcmil ("250 kcmil") or mm² ("70 mm2"). Words
 * after the size, such as the insulation, are ignored. Null when nothing at the start reads as a size.
 */
export function readGauge(awg: string | null): CableSize | null {
  if (awg === null) return null
  const s = awg.toUpperCase().trim().replace(/^#\s*/, '')
  const kcmil = KCMIL.exec(s)
  if (kcmil) return { mm2: decimal(kcmil[1]!) * MM2_PER_KCMIL, label: `${kcmil[1]} kcmil` }
  const mm2 = MM2.exec(s)
  if (mm2) return { mm2: decimal(mm2[1]!), label: `${mm2[1]} mm²` }
  const gauge = AWG.exec(s)
  return gauge ? readAwg(gauge[1]!) : null
}

/** The size of a wiring line: its mm² when stated, else its AWG. */
export function lineSize(specs: { mm2: number | null; awg: string | null }): CableSize | null {
  if (specs.mm2 !== null) return { mm2: specs.mm2, label: `${specs.mm2} mm²` }
  return readGauge(specs.awg)
}

/** The thickest table gauge a cable of this area matches; null when it is thinner than the thinnest. */
export function tableGauge(mm2: number): Gauge | null {
  return GAUGES.filter((g) => mm2 >= g.mm2 * MM2_TOLERANCE).at(-1) ?? null
}
