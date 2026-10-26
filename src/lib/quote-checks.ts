import { CURRENCY_CODES } from './parse-amount'
import { PRODUCT_LIMITS } from './product-limits'
import { hasOptions, optionLines } from './quote-options'
import { UNLISTED_OPTION, type LineSpecs, type QuoteExtraction, type QuoteLine, type QuoteOption } from './quote-schema'

export type CheckFailure =
  | 'no_lines' | 'no_total' | 'bad_currency' | 'bad_qty' | 'line_mismatch' | 'total_mismatch' | 'option_total_mismatch' | 'unknown_option'
  | 'implausible'

const LINE_TOLERANCE = 0.01
const TOTAL_TOLERANCE = 0.02
/** Rounding in a document is allowed one whole currency unit, however small the amount. */
const MIN_ABSOLUTE_TOLERANCE = 1

const near = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= Math.max(MIN_ABSOLUTE_TOLERANCE, Math.abs(b) * tolerance)

/** A total a quote can be ranked by: a positive, finite amount. */
export const hasTotal = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

const includedSum = (lines: readonly QuoteLine[]): number => lines.filter((l) => !l.optional).reduce((a, l) => a + l.lineTotal, 0)

/**
 * What a single-system quote's included lines and stated tax add up to: the figure its total is checked against, and the
 * one shown beside the total field. A tax the quote also lists as a line is counted once.
 */
export function linesWithTax(x: QuoteExtraction): number {
  const { base, tax } = documentTax(x)
  return base + (tax ?? 0)
}

/** Each option's price (see pricesOf): the total it is checked and ranked by, null when it states none. */
export const optionPrices = (x: QuoteExtraction): { id: string; total: number | null }[] =>
  pricesOf(x).options.map(({ id, price }) => ({ id, total: price.total }))

/**
 * Words a tax line is written with ("IVA", "I.V.A.", "ITBIS", the Dominican sales tax, "ITBMS", Panama's, "IGV", Peru's,
 * "IVU", Puerto Rico's, "VAT", "GST", "sales tax", "impuesto"), once accents and dots are dropped.
 */
const TAX_WORDS = /\b(iva|itbis|itbms|igv|ivu|vat|gst|tax(es)?|impuestos?)\b/
const DIACRITICS = /\p{Diacritic}/gu
const namesTax = (text: string): boolean => TAX_WORDS.test(text.normalize('NFD').replace(DIACRITICS, '').replace(/\./g, '').toLowerCase())

/** Whether a price's total holds its tax: yes, no (the tax is stated but left out), or unknown (no tax stated, no total). */
export type TaxIncluded = 'yes' | 'no' | 'unknown'

/**
 * What one system costs, read once from a quote: the base (its included lines, less a line read as its tax), the tax,
 * the total it is checked and ranked by, whether that total holds the tax, and where each figure came from.
 */
export interface Price {
  base: number
  /** Null when the reading states no tax for this system. */
  tax: number | null
  /** Null when the reading states no price for this system. */
  total: number | null
  taxIncluded: TaxIncluded
  from: { tax: 'written' | 'line' | 'rate' | null; total: 'written' | 'typed' | 'lines' | null }
  /** A written total that disagrees with the lines and tax: the reading needs checking. */
  isMismatch: boolean
}

export interface QuotePrices { quote: Price; options: { id: string; price: Price }[] }

/** An included line that says it is a tax and charges one. A VAT line can only be read as kind `other`. */
const isTaxLine = (l: QuoteLine): boolean =>
  !l.optional && l.kind === 'other' && hasTotal(l.lineTotal) && (namesTax(l.description) || namesTax(l.source.text))

/**
 * The line that is the tax, when there is one. With a tax written, it has to be for that amount, so a separate charge
 * that costs the same (freight, say) still leaves the tax to add. With none written, any line that charges tax is it.
 * A line that names tax at no charge ("ITBIS no incluido") charges none.
 */
const taxLineOf = (lines: readonly QuoteLine[], written: number | null): QuoteLine | undefined =>
  lines.find((l) => isTaxLine(l) && (written === null || near(l.lineTotal, written, LINE_TOLERANCE)))

/**
 * A single-system quote's base and the tax its document states: an included tax line counted once, so the base leaves
 * it out. This is what its total is checked against.
 */
function documentTax(x: QuoteExtraction): { base: number; tax: number | null; taxLine: QuoteLine | undefined } {
  const written = hasTotal(x.tax) ? x.tax : null
  const taxLine = taxLineOf(x.lines, written)
  return { base: includedSum(x.lines) - (taxLine?.lineTotal ?? 0), tax: taxLine?.lineTotal ?? written, taxLine }
}

/**
 * A single-system quote. With a subtotal or tax stated, the lines plus tax must make the total. With neither, the total
 * may be above the lines (tax or freight the quote doesn't itemise), never below them: that is a misread total, a dropped
 * digit or a decimal point read as a thousands one, and as the lowest price it would win. A total the user typed is
 * the one it ranks by, so whether that total holds the tax follows it; the check stays on the total the document wrote.
 * A quote offering one system ranks as a single-system quote, so the tax written for that option is its tax when the
 * document states none (#38); the check stays on the document's own tax.
 */
function quotePrice(x: QuoteExtraction, typedTotal: number | null): Price {
  const { base, tax: docTax, taxLine } = documentTax(x)
  const lone = x.options.length === 1 && hasTotal(x.options[0]!.tax) ? x.options[0]!.tax : null
  const tax = docTax ?? lone
  const sum = base + (docTax ?? 0)
  const read = hasTotal(x.total) ? x.total : null
  const isTyped = hasTotal(typedTotal)
  const total = isTyped ? typedTotal : read
  const isOff = !near(sum, x.total, TOTAL_TOLERANCE)
  return {
    base, tax, total, taxIncluded: total === null || tax === null ? 'unknown' : taxIncludedOf(readTotal(total, quoteCandidates(x, lone), true), tax),
    from: { tax: taxLine ? 'line' : tax === null ? null : 'written', total: isTyped ? 'typed' : read === null ? null : 'written' },
    isMismatch: x.subtotal !== null || x.tax !== null ? isOff : read !== null && read < sum && isOff,
  }
}

/**
 * The totals a single-system quote may be written as. Untaxed: its included lines less every tax line. Taxed: its lines
 * when they list a tax, and its lines, with or without their tax lines, plus a tax written for it.
 */
function quoteCandidates(x: QuoteExtraction, lone: number | null): Candidate[] {
  const lines = includedSum(x.lines)
  const taxLines = x.lines.filter(isTaxLine)
  const untaxed = lines - includedSum(taxLines)
  const written = [x.tax, lone].filter(hasTotal)
  return [
    { total: untaxed, hasTax: false, rate: false },
    ...(taxLines.length > 0 ? [{ total: lines, hasTax: true, rate: false }] : []),
    ...written.flatMap((t) => [untaxed + t, lines + t].map((total) => ({ total, hasTax: true, rate: false }))),
  ]
}

/** A total a system may be written as, and whether it holds a tax. */
interface Candidate { total: number; hasTax: boolean; rate: boolean }

/**
 * The candidate a written total is read as: the nearest one. At a low rate the bare lines and the lines with tax can both
 * fall within the tolerance, and a total that is exactly its lines leaves the tax out. A tie goes to a taxed candidate.
 */
const nearestTo = (total: number, candidates: readonly Candidate[]): Candidate | undefined =>
  candidates.reduce<Candidate | undefined>((best, c) => {
    if (best === undefined) return c
    const gap = Math.abs(total - c.total) - Math.abs(total - best.total)
    return gap < 0 || (gap === 0 && c.hasTax && !best.hasTax) ? c : best
  }, undefined)

/**
 * How a written total reads against the totals a system may be written as: the ones it matches, and the taxed one it is
 * read as, if any. The one rule for a quote and an option. A system that states its own tax, written or as a line, holds
 * it whenever a taxed total matches, though at a low rate its bare lines match too (review R6). One that states none can
 * only be taxed at the document's rate, and is read as the candidate it is nearest (review R5).
 */
function readTotal(total: number, candidates: readonly Candidate[], isStated: boolean): { matches: Candidate[]; taxed: Candidate | undefined } {
  const matches = candidates.filter((c) => near(total, c.total, TOTAL_TOLERANCE))
  const read = isStated ? matches.find((c) => c.hasTax) : nearestTo(total, matches)
  return { matches, taxed: read?.hasTax ? read : undefined }
}

const taxIncludedOf = (read: ReturnType<typeof readTotal>, tax: number | null): TaxIncluded =>
  read.taxed ? 'yes' : read.matches.length > 0 && tax !== null ? 'no' : 'unknown'

/**
 * An option's price. Its total is the one written for it, else its own included lines plus the shared ones, plus the tax
 * written for it, so an option stated as "subtotal + tax" ranks at what it costs. The document's own tax is not spread
 * over options: which option it belongs to is unknown. It can only explain a written total at the rate the document
 * states (its tax over its subtotal), never as a flat amount, which belongs to one subtotal. An option whose own lines
 * carry no price has none: shared lines or tax alone don't price a system, and a total written for it isn't checked.
 * A written total that matches lines listing a tax line, the option's own or shared, holds a tax (review R7). The price
 * counts a written tax once only against the option's own tax line, as staging did.
 */
function optionPrice(x: QuoteExtraction, o: QuoteOption): Price {
  const ownLines = x.lines.filter((l) => l.option === o.id)
  const systemLines = optionLines(x, o.id)
  const own = includedSum(ownLines)
  const withShared = includedSum(systemLines)
  const written = hasTotal(o.tax) ? o.tax : null
  const taxLine = written === null ? taxLineOf(systemLines, null) : taxLineOf(ownLines, written)
  const lineTax = taxLine?.lineTotal ?? null
  const base = withShared - (lineTax ?? 0)
  const listsTax = systemLines.some(isTaxLine)
  const rate = hasTotal(x.tax) && hasTotal(x.subtotal) ? x.tax / x.subtotal : null
  const candidates: Candidate[] = [own, withShared].flatMap((b) => [
    { total: b, hasTax: listsTax, rate: false },
    ...(written !== null ? [{ total: b + written, hasTax: true, rate: false }] : []),
    ...(rate !== null ? [{ total: b * (1 + rate), hasTax: true, rate: true }] : []),
  ])
  const isPriced = own > 0
  if (hasTotal(o.total)) {
    const read = isPriced ? readTotal(o.total, candidates, written !== null || listsTax) : { matches: [], taxed: undefined }
    const tax = lineTax ?? written ?? (read.taxed?.rate ? o.total - o.total / (1 + rate!) : null)
    return {
      base, tax, total: o.total, taxIncluded: taxIncludedOf(read, tax),
      from: { tax: taxLine ? 'line' : written !== null ? 'written' : tax !== null ? 'rate' : null, total: 'written' },
      isMismatch: isPriced && read.matches.length === 0,
    }
  }
  const tax = lineTax ?? written
  return {
    base, tax, total: isPriced ? base + (tax ?? 0) : null, taxIncluded: isPriced && tax !== null ? 'yes' : 'unknown',
    from: { tax: taxLine ? 'line' : written !== null ? 'written' : null, total: isPriced ? 'lines' : null },
    isMismatch: false,
  }
}

/**
 * The one place a reading's tax is worked out: the price of the quote as a single system, and of each option it offers.
 * Every total check, rank price and tax caveat reads these. A total the user typed prices the quote as a single system
 * only: options keep the totals written for them.
 */
export const pricesOf = (x: QuoteExtraction, typedTotal: number | null = null): QuotePrices => ({
  quote: quotePrice(x, typedTotal),
  options: x.options.map((o) => ({ id: o.id, price: optionPrice(x, o) })),
})

/** The price of the quote (optionId null) or of one option of it. An option not in the reading has none. */
export function priceOf(x: QuoteExtraction, optionId: string | null, typedTotal: number | null = null): Price | null {
  const prices = pricesOf(x, typedTotal)
  return optionId === null ? prices.quote : prices.options.find((p) => p.id === optionId)?.price ?? null
}

/** Whether a price states tax and its total holds it, as far as the reading tells: false when it states none or leaves it out. */
export const includesTax = (p: Price | null): boolean => p !== null && p.tax !== null && p.taxIncluded !== 'no'

/**
 * How far a reading's numbers may go, per unit, before a slipped unit or digit is the likelier story: 5,120 kWh is Wh
 * read as kWh. Equipment bounds are the product library's (PRODUCT_LIMITS); the amount cap leaves room for COP and VES.
 * Only numbers past a bound fail: a missing or non-numeric one is the other checks' business (no_total, bad_qty).
 */
const PLAUSIBLE = {
  PANEL_WATTS: 1000, MAX_SURGE_RATIO: 5, BANK_TOLERANCE: 0.15, QTY: 10_000, AMOUNT: 1_000_000_000, FIRST_YEAR: 2000, LAST_YEAR: 2100,
} as const
/** The most each stated spec may be. Every stated spec must also be above 0; a cable section has no upper bound. */
const SPEC_MAX = {
  watts: PRODUCT_LIMITS.WATTS, surgeWatts: PRODUCT_LIMITS.WATTS, panelWatts: PLAUSIBLE.PANEL_WATTS, batteryVolts: PRODUCT_LIMITS.VOLTS,
  ah: PRODUCT_LIMITS.AH, kWh: PRODUCT_LIMITS.KWH, chargerAmps: PRODUCT_LIMITS.AMPS, fuseAmps: PRODUCT_LIMITS.AMPS, mm2: Number.POSITIVE_INFINITY,
} as const satisfies Partial<Record<keyof LineSpecs, number>>
const SPEC_KEYS = Object.keys(SPEC_MAX) as (keyof typeof SPEC_MAX)[]
const WH_PER_KWH = 1000

/** A spec out of range, a surge outside 1× to 5× the watts, or a bank whose volts × Ah is more than 15% off its kWh. */
function hasImplausibleSpecs(s: LineSpecs): boolean {
  const isOutOfRange = SPEC_KEYS.some((k) => {
    const v = s[k]
    return v !== null && (v <= 0 || v > SPEC_MAX[k])
  })
  const isSurgeOff = s.watts !== null && s.surgeWatts !== null &&
    (s.surgeWatts < s.watts || s.surgeWatts > s.watts * PLAUSIBLE.MAX_SURGE_RATIO)
  const isBankOff = s.batteryVolts !== null && s.ah !== null && s.kWh !== null &&
    Math.abs((s.batteryVolts * s.ah) / WH_PER_KWH - s.kWh) > s.kWh * PLAUSIBLE.BANK_TOLERANCE
  return isOutOfRange || isSurgeOff || isBankOff
}

/** An amount in the quote's currency past the cap; a discount, written negative, counts by its size. */
const isPastAmountCap = (n: number | null): boolean => n !== null && Math.abs(n) > PLAUSIBLE.AMOUNT

/** A source page outside 1 to the file's page count, or only below 1 when the count is unknown (an image has none). */
const isOffThePages = (page: number | null, pages: number | null): boolean =>
  page !== null && (!Number.isInteger(page) || page < 1 || (pages !== null && page > pages))

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * A date written YYYY-MM-DD that is not a real day from 2000 to 2100. One written another way, or blank, is left as
 * read: nothing ranks on a date, and the prompt asks for no format, so turning it away could hide a real quote.
 */
function isImplausibleDate(date: string | null): boolean {
  const match = date === null ? null : ISO_DATE.exec(date)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return year < PLAUSIBLE.FIRST_YEAR || year > PLAUSIBLE.LAST_YEAR || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day
}

/** Whether any number in a reading is past what a real quote states (PLAUSIBLE). `pages` is the file's page count, if known. */
function isImplausible(x: QuoteExtraction, pages: number | null): boolean {
  const amounts = [x.subtotal, x.tax, x.total, ...x.options.flatMap((o) => [o.total, o.tax]), ...x.lines.flatMap((l) => [l.unitPrice, l.lineTotal])]
  return x.lines.some((l) => hasImplausibleSpecs(l.specs) || l.qty > PLAUSIBLE.QTY || isOffThePages(l.source.page, pages)) ||
    amounts.some(isPastAmountCap) ||
    x.warranties.some((w) => w.years < 0 || w.years > PRODUCT_LIMITS.YEARS) ||
    [x.date, x.validUntil].some(isImplausibleDate)
}

/**
 * Why an extraction can't be trusted as is; an empty list means it passed. `pages` is the file's page count (quotes.pages),
 * null when unknown: an image has none.
 */
export function checkExtraction(x: QuoteExtraction, pages: number | null = null): CheckFailure[] {
  const failures: CheckFailure[] = []
  if (x.lines.length === 0) failures.push('no_lines')
  // The schema needs a number, so a quote that states no total comes back as 0: it waits for the user's total. A quote
  // offering several systems has no total of its own; it needs a price for at least one of them.
  const isMulti = hasOptions(x)
  const prices = pricesOf(x)
  const isPriced = isMulti ? prices.options.some((o) => o.price.total !== null) : prices.quote.total !== null
  if (!isPriced) failures.push('no_total')
  if (!/^[A-Z]{3}$/.test(x.currency) || !CURRENCY_CODES.has(x.currency)) failures.push('bad_currency')
  if (x.lines.some((l) => !(l.qty > 0))) failures.push('bad_qty')
  // Such a line or warranty is in no option, so the reading can't be trusted to price, size or cover any of them.
  if ([...x.lines, ...x.warranties].some((i) => i.option === UNLISTED_OPTION)) failures.push('unknown_option')
  if (x.lines.some((l) => l.unitPrice !== null && !near(l.qty * l.unitPrice, l.lineTotal, LINE_TOLERANCE))) {
    failures.push('line_mismatch')
  }
  // Alternatives don't add up to anything, so a quote with options skips the total check; each line is still checked,
  // and so is each option's own written total.
  if (isMulti && prices.options.some((o) => o.price.isMismatch)) failures.push('option_total_mismatch')
  if (!isMulti && prices.quote.isMismatch) failures.push('total_mismatch')
  if (isImplausible(x, pages)) failures.push('implausible')
  return failures
}

/** The failures a total the user types settles: the total itself was missing or disagreed with the lines. */
const TOTAL_FAILURES: ReadonlySet<CheckFailure> = new Set(['no_total', 'total_mismatch'])

/**
 * Whether a reading that failed its checks can be ranked once the user types its total. A wrong line amount, quantity,
 * currency or option, or an implausible number, is a reading to redo: a typed total would rank it with that error in it.
 */
export const isFixedByTotal = (x: QuoteExtraction): boolean => checkExtraction(x).every((f) => TOTAL_FAILURES.has(f))
