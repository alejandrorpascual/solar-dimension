import { caveatsOf, type Caveat } from './quote-caveats'
import { checkExtraction, hasTotal, isFixedByTotal, optionPrices, statesTax } from './quote-checks'
import { checkItems, includedArrayW, itemsFor, type ItemCheck, type ItemId, type KitNeeds, type Musts, type Overrides } from './quote-items'
import { hasOptions, optionExtraction } from './quote-options'
import { isPending, type QuoteExtraction, type QuoteStatus } from './quote-schema'

export interface QuoteView {
  id: string; fileName: string; label: string | null
  status: QuoteStatus; extraction: QuoteExtraction | null
  overrides: Overrides; totalOverride: number | null
  createdAt: number
  /** Read agains used: the card hides Read again at MAX_RETRIES, and a reading read again takes the user's total (takesTypedTotal). */
  retries: number
  /** The file's page count (quotes.pages), which a reading's source pages are checked against; null for an image. */
  pages: number | null
}
export type Fit = 'fits' | 'unclear' | 'short'
/** Which of a quote's systems an entry is. A single-system quote has no option and an option count of 0. */
export interface EntryOption { optionId: string | null; optionLabel: string | null; optionCount: number }
export interface RankedQuote extends EntryOption {
  quote: QuoteView; name: string; items: ItemCheck[]; fit: Fit
  total: number; currency: string; rank: number; delta: number | null
  unknownMusts: ItemId[]; failedMusts: ItemId[]; niceMet: number; usableWh: number
  /**
   * The solar array the quote (or this option) includes, in W, whether or not the kit asks for one: null when one of
   * its panels states no wattage, so the sum would fall short.
   */
  panelsW: number | null
  /** What it leaves to confirm though it meets every must-have; see quote-caveats.ts. */
  caveats: Caveat[]
}
/**
 * needs_review: the total doesn't add up with the lines, or a reading read again still doesn't hold; no_total: the quote
 * was read but states no total. Both wait for the user's total. misread: a single-system reading whose line amounts,
 * quantities or currency don't hold, that has no lines, or that states an implausible number, which a typed total
 * wouldn't fix: it waits to be read again (takesTypedTotal). no_price: an option of a quote that offers several states no
 * price for it. duplicate: it reads exactly like an earlier upload, which ranks in its place.
 */
export type UnrankedReason = 'reading' | 'needs_review' | 'no_total' | 'misread' | 'no_price' | 'failed' | 'other_currency' | 'duplicate'
export interface UnrankedQuote extends EntryOption { quote: QuoteView; name: string; reason: UnrankedReason; currency: string | null }
export interface Verdict {
  currency: string | null
  /** Currencies with as many quotes as `currency`, which took the tie as the one with the earliest quote: said on screen, not ranked. */
  tiedCurrencies: string[]
  ranked: RankedQuote[]
  unranked: UnrankedQuote[]
  best: RankedQuote | null
  nextFit: RankedQuote | null
  /** Unclear quotes that could win once the user confirms what they don't mention. */
  worthAsking: RankedQuote[]
  /** When nothing fits: the short quote with the fewest failed must-haves. */
  closest: RankedQuote | null
  /** When the best fit has something to confirm: the cheapest quote that fits with nothing to confirm, if any. */
  cleanFit: RankedQuote | null
  mustCount: number
  /** Quotes that produced a reading: finished, and not failed. */
  readCount: number
  /** Quotes the model gave up on. */
  failedCount: number
}

type Scored = Omit<RankedQuote, 'rank' | 'delta'>

export function quoteName(q: QuoteView): string {
  return q.label?.trim() || q.extraction?.vendor.name?.trim() || q.fileName
}

/** A second line that tells same-vendor quotes apart: the file name, unless it already is the shown name. */
export function quoteSubtitle(q: QuoteView): string | null {
  return quoteName(q) === q.fileName ? null : q.fileName
}

/** What tells entries apart: the quote, and the option for a quote that offers several. */
export const entryKey = (e: { quote: { id: string }; optionId: string | null }): string =>
  e.optionId === null ? e.quote.id : `${e.quote.id}:${e.optionId}`

/** The vendor, and the option when the quote offers several: "SUNA M.P. · Inversor 10 kW". */
export const entryName = (e: { name: string; optionLabel: string | null }): string =>
  e.optionLabel ? `${e.name} · ${e.optionLabel}` : e.name

/** One thing to rank: a whole quote, or one of the systems a quote offers, with the lines and price of that system. */
interface Entry extends EntryOption { quote: QuoteView; extraction: QuoteExtraction | null; total: number | null }

/** The total a quote ranks by: the user's, else the one read. */
const totalOf = (q: QuoteView): number | null => q.totalOverride ?? q.extraction?.total ?? null

/**
 * Whether the user's total can rank a reading that needs review: when its total was all that failed, or once it has been
 * read again. A wrong line amount, quantity or currency is a reading to redo first, but one that still doesn't hold may be
 * the document itself (a discount taken off a line, a quote with no lines): it reads the same every time, and without a
 * total to type it could never be compared. One read again is the test, since each can cost up to 4 model calls. An
 * implausible reading (a 5,120 kWh battery) never takes one: no document is written that way, and its sizes would rank.
 * Nor does one with no currency read: a typed total would rank it in a currency nobody stated.
 */
export function takesTypedTotal(q: QuoteView): boolean {
  if (q.extraction === null) return false
  const failures = checkExtraction(q.extraction, q.pages)
  if (failures.includes('implausible') || failures.includes('bad_currency')) return false
  return q.retries > 0 || isFixedByTotal(q.extraction)
}

/**
 * A ready quote that offers several systems is one entry per option, priced from the document alone: the user's typed
 * total belongs to a single-system quote. Any other quote is one entry. One with options whose numbers need checking
 * has no price, so it waits as one card.
 */
function entriesOf(q: QuoteView): Entry[] {
  const x = q.extraction
  const optionCount = x !== null && hasOptions(x) ? x.options.length : 0
  if (x === null || optionCount === 0 || q.status !== 'ready') {
    return [{ quote: q, extraction: x, total: optionCount === 0 ? totalOf(q) : null, optionId: null, optionLabel: null, optionCount }]
  }
  const prices = optionPrices(x)
  return x.options.map((o, i) => ({
    quote: q, extraction: optionExtraction(x, o.id), total: prices[i]!.total, optionId: o.id, optionLabel: o.label, optionCount,
  }))
}

const optionOf = (e: Entry): EntryOption => ({ optionId: e.optionId, optionLabel: e.optionLabel, optionCount: e.optionCount })

/**
 * Read, and with a positive price. A total of 0 (what the model writes when a quote states none), negative or not a
 * number never ranks: the quote waits for the user's total, like one whose amounts don't add up. A reading that needs
 * review ranks on the user's total only when the total was all that failed, or once it has been read again.
 */
const isRankable = (e: Entry): boolean =>
  e.extraction !== null && hasTotal(e.total) &&
  (e.quote.status === 'ready' || (e.quote.status === 'needs_review' && e.quote.totalOverride !== null && takesTypedTotal(e.quote)))

const byUpload = (a: { quote: QuoteView }, b: { quote: QuoteView }) => a.quote.createdAt - b.quote.createdAt

/**
 * The entries left once a file uploaded twice counts once: an entry whose quote reads exactly like an earlier upload's
 * (the same reading, the same option of it, and nothing the user typed or confirmed that differs) is that upload's
 * duplicate. A copy the user changed is its own quote, so what they entered is never hidden. Kept in the order given.
 */
function withoutDuplicates(entries: readonly Entry[]): Entry[] {
  const first = new Map<string, Entry>()
  for (const e of [...entries].sort(byUpload)) {
    const { extraction, totalOverride, overrides } = e.quote
    const key = `${JSON.stringify([extraction, totalOverride, overrides])}|${e.optionId}`
    if (!first.has(key)) first.set(key, e)
  }
  const kept = new Set(first.values())
  return entries.filter((e) => kept.has(e))
}

/**
 * The currency most rankable quotes use, counting each file once; a tie goes to the earliest quote's currency, and the
 * other currencies in the tie are returned to be said on screen.
 */
function mainCurrency(entries: readonly Entry[]): { currency: string | null; tied: string[] } {
  // In upload order, so the counts are keyed in the order each currency first appears.
  const quotes = [...new Map([...entries].sort(byUpload).map((e) => [e.quote.id, e.quote])).values()]
  const counts = new Map<string, number>()
  for (const q of quotes) counts.set(q.extraction!.currency, (counts.get(q.extraction!.currency) ?? 0) + 1)
  const most = Math.max(0, ...counts.values())
  const [currency = null, ...tied] = [...counts.keys()].filter((c) => counts.get(c) === most)
  return { currency, tied }
}

/** Why an entry is not ranked. A rankable entry that got here is a duplicate, or in another currency, whatever its status. */
function unrankedReason(e: Entry, unique: readonly Entry[]): UnrankedReason {
  if (isPending(e.quote.status)) return 'reading'
  if (isRankable(e)) return unique.includes(e) ? 'other_currency' : 'duplicate'
  if (e.optionId !== null) return 'no_price'
  if (e.extraction === null || (e.quote.status !== 'needs_review' && e.quote.status !== 'ready')) return 'failed'
  // A quote with options has no total form either way: it is read again.
  if (e.quote.status === 'needs_review' && e.optionCount === 0 && !takesTypedTotal(e.quote)) return 'misread'
  return hasTotal(e.total) ? 'needs_review' : 'no_total'
}

function score(e: Entry, kit: KitNeeds, musts: Musts, currency: string, taxElsewhere: boolean): Scored {
  const items = checkItems(e.extraction!, kit, e.quote.overrides)
  const mustItems = items.filter((c) => musts[c.id])
  const failedMusts = mustItems.filter((c) => c.status === 'short' || c.status === 'missing').map((c) => c.id)
  const unknownMusts = mustItems.filter((c) => c.status === 'unknown').map((c) => c.id)
  const fit: Fit = failedMusts.length > 0 ? 'short' : unknownMusts.length > 0 ? 'unclear' : 'fits'
  return {
    quote: e.quote, name: quoteName(e.quote), ...optionOf(e), items, fit, currency,
    total: e.total!,
    failedMusts, unknownMusts,
    niceMet: items.filter((c) => !musts[c.id] && c.status === 'ok').length,
    usableWh: items.find((c) => c.id === 'battery')?.facts.usableWh ?? 0,
    panelsW: includedArrayW(e.extraction!),
    caveats: caveatsOf({ items, extraction: e.extraction!, quote: e.quote, optionId: e.optionId }, kit, musts, taxElsewhere),
  }
}

const byTotal = (a: Scored, b: Scored) => a.total - b.total
/** Price decides; at the same price, fewer things to confirm, then more nice-to-haves, then more usable energy. */
const byFitsOrder = (a: Scored, b: Scored) =>
  a.total - b.total || a.caveats.length - b.caveats.length || b.niceMet - a.niceMet || b.usableWh - a.usableWh

/** Ranks the read quotes against the kit. Pure; recomputed on every render. */
export function compareQuotes(kit: KitNeeds, musts: Musts, quotes: readonly QuoteView[]): Verdict {
  const entries = quotes.flatMap(entriesOf)
  const rankable = withoutDuplicates(entries.filter(isRankable))
  const { currency, tied } = mainCurrency(rankable)
  const inCurrency = rankable.filter((e) => e.extraction!.currency === currency)
  const unranked: UnrankedQuote[] = entries
    .filter((e) => !inCurrency.includes(e))
    .map((e) => ({ quote: e.quote, name: quoteName(e.quote), ...optionOf(e), reason: unrankedReason(e, rankable), currency: e.extraction?.currency ?? null }))

  // Whether another entry ranked beside one states tax, another quote or another option of its own: then one that
  // states none may be priced without it.
  const taxed = inCurrency.filter((e) => statesTax(e.quote.extraction!, e.optionId)).map(entryKey)
  const taxElsewhere = (e: Entry): boolean => taxed.some((key) => key !== entryKey(e))
  const scored = currency === null ? [] : inCurrency.map((e) => score(e, kit, musts, currency, taxElsewhere(e)))
  const fits = scored.filter((s) => s.fit === 'fits').sort(byFitsOrder)
  const unclear = scored.filter((s) => s.fit === 'unclear').sort(byTotal)
  const short = scored.filter((s) => s.fit === 'short').sort(byTotal)
  const bestTotal = fits[0]?.total ?? null
  const ranked: RankedQuote[] = [...fits, ...unclear, ...short].map((s, i) => ({
    ...s, rank: i + 1, delta: bestTotal === null ? null : s.total - bestTotal,
  }))

  const best = ranked[0]?.fit === 'fits' ? ranked[0] : null
  const nextFit = best ? ranked.find((r) => r.fit === 'fits' && r !== best) ?? null : null
  const worthAsking = ranked.filter((r) => r.fit === 'unclear' && (best === null || r.total < best.total))
  const closest = best
    ? null
    : [...ranked.filter((r) => r.fit === 'short')].sort((a, b) => a.failedMusts.length - b.failedMusts.length || a.total - b.total)[0] ?? null

  const cleanFit = best !== null && best.caveats.length > 0 ? ranked.find((r) => r.fit === 'fits' && r.caveats.length === 0) ?? null : null

  return {
    currency, tiedCurrencies: tied, ranked, unranked, best, nextFit, worthAsking, closest, cleanFit,
    mustCount: itemsFor(kit).filter((id) => musts[id]).length,
    readCount: quotes.filter((q) => !isPending(q.status) && q.status !== 'failed').length,
    failedCount: quotes.filter((q) => q.status === 'failed').length,
  }
}

/** Every quote has finished and none produced a reading: there is no verdict, only quotes to retry. */
export const nothingRead = (v: Verdict): boolean =>
  v.readCount === 0 && v.failedCount > 0 && !v.unranked.some((u) => u.reason === 'reading')
