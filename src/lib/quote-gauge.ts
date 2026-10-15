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

/** A count of conductors or runs written before the size ("2 x 4/0", "3× 6 AWG"): the size is what follows it. */
const COUNT = /^\d+\s*[X×*]\s*/
/** The word for gauge written before the size: "AWG 4/0", "Cal. 4/0", "calibre 6". */
const GAUGE_WORD = /^(?:AWG|CAL(?:IBRE)?\.?)\s*/
const KCMIL = /^(\d+(?:[.,]\d+)?)\s*(?:KCMIL|MCM)\b/
/** mm², also written mm2, mm^2, sq mm or plain mm: a cable's size in mm is its cross-section. */
const MM2 = /^(\d+(?:[.,]\d+)?)\s*(?:SQ\.?\s*)?MM(?:\^?2|²)?(?![A-Z])/
/** A gauge written n/0 ("2/0", "4/0 cobre", "1/0AWG", "4/0-600V"): no count or other size is written that way. */
const SLASH_AWG = /^(\d\/0)(?![\d/])/
/**
 * A gauge written as a bare number ("4", "00", "10 AWG"), and the word after it. Not when a digit or slash follows,
 * nor decimals or a dash and a number ("2.5", "2-4/0"): the number at the start is then not the gauge.
 */
const BARE_AWG = /^(0{1,4}|\d{1,2})(?![\d/]|[.,]\d|\s*[-–]\s*\d)\s*([A-Z]*)/
/** Words that make a bare number a gauge. */
const AWG_WORDS: ReadonlySet<string> = new Set(['AWG', 'GA', 'GAUGE'])
/** What else may follow a bare gauge: nothing, its insulation or its metal. Any other word makes the number a count ("2 tramos"). */
const AFTER_GAUGE: ReadonlySet<string> = new Set([...AWG_WORDS, '', 'THHN', 'THWN', 'THW', 'XHHW', 'RHW', 'USE', 'CU', 'COBRE', 'COPPER'])
/** A bare number past this with no "AWG" after it is mm² with the unit left out ("35"), not a hair-thin AWG wire. */
const BARE_AWG_MAX = 14

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
 * A size written as AWG ("2/0", "2/0 AWG", "#4", "00", "2 AWG THHN"), kcmil ("250 kcmil") or mm² ("70 mm2"). A count
 * or the word for gauge before the size, and words after it such as the insulation, are ignored. Null when nothing at
 * the start reads as a size: a number that may not be the gauge is no size, so the quote's size is left to confirm.
 */
export function readGauge(awg: string | null): CableSize | null {
  if (awg === null) return null
  const s = awg.toUpperCase().trim().replace(/\s*\/\s*/g, '/')
    .replace(GAUGE_WORD, '').replace(COUNT, '').replace(GAUGE_WORD, '').replace(/^#\s*/, '')
  const kcmil = KCMIL.exec(s)
  if (kcmil) return { mm2: decimal(kcmil[1]!) * MM2_PER_KCMIL, label: `${kcmil[1]} kcmil` }
  const mm2 = MM2.exec(s)
  if (mm2) return { mm2: decimal(mm2[1]!), label: `${mm2[1]} mm²` }
  const slash = SLASH_AWG.exec(s)
  if (slash) return readAwg(slash[1]!)
  const bare = BARE_AWG.exec(s)
  if (bare === null || !AFTER_GAUGE.has(bare[2]!)) return null
  return AWG_WORDS.has(bare[2]!) || Number(bare[1]) <= BARE_AWG_MAX ? readAwg(bare[1]!) : null
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
