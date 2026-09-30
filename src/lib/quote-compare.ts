import { checkItems, ITEM_IDS, type ItemCheck, type ItemId, type KitNeeds, type Musts, type Overrides } from './quote-items'
import { isPending, type QuoteExtraction, type QuoteStatus } from './quote-schema'

export interface QuoteView {
  id: string; fileName: string; label: string | null
  status: QuoteStatus; extraction: QuoteExtraction | null
  overrides: Overrides; totalOverride: number | null
  createdAt: number
}
export type Fit = 'fits' | 'unclear' | 'short'
export interface RankedQuote {
  quote: QuoteView; name: string; items: ItemCheck[]; fit: Fit
  total: number; currency: string; rank: number; delta: number | null
  unknownMusts: ItemId[]; failedMusts: ItemId[]; niceMet: number; usableWh: number
}
export type UnrankedReason = 'reading' | 'needs_review' | 'failed' | 'other_currency'
export interface UnrankedQuote { quote: QuoteView; name: string; reason: UnrankedReason; currency: string | null }
export interface Verdict {
  currency: string | null
  ranked: RankedQuote[]
  unranked: UnrankedQuote[]
  best: RankedQuote | null
  nextFit: RankedQuote | null
  /** Unclear quotes that could win once the user confirms what they don't mention. */
  worthAsking: RankedQuote[]
  /** When nothing fits: the short quote with the fewest failed must-haves. */
  closest: RankedQuote | null
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

const isRankable = (q: QuoteView): boolean =>
  q.extraction !== null && (q.status === 'ready' || (q.status === 'needs_review' && q.totalOverride !== null))

/** The currency most rankable quotes use; a tie goes to the earliest quote's currency. */
function mainCurrency(quotes: readonly QuoteView[]): string | null {
  const counts = new Map<string, number>()
  for (const q of quotes) counts.set(q.extraction!.currency, (counts.get(q.extraction!.currency) ?? 0) + 1)
  let best: string | null = null
  let most = 0
  for (const q of [...quotes].sort((a, b) => a.createdAt - b.createdAt)) {
    const n = counts.get(q.extraction!.currency) ?? 0
    if (n > most) { best = q.extraction!.currency; most = n }
  }
  return best
}

/** Why a quote is not ranked. A rankable quote that got here can only be in another currency, whatever its status. */
function unrankedReason(q: QuoteView): UnrankedReason {
  if (isPending(q.status)) return 'reading'
  if (isRankable(q)) return 'other_currency'
  if (q.status === 'needs_review') return 'needs_review'
  return 'failed'
}

function score(q: QuoteView, kit: KitNeeds, musts: Musts, currency: string): Scored {
  const items = checkItems(q.extraction!, kit, q.overrides)
  const mustItems = items.filter((c) => musts[c.id])
  const failedMusts = mustItems.filter((c) => c.status === 'short' || c.status === 'missing').map((c) => c.id)
  const unknownMusts = mustItems.filter((c) => c.status === 'unknown').map((c) => c.id)
  const fit: Fit = failedMusts.length > 0 ? 'short' : unknownMusts.length > 0 ? 'unclear' : 'fits'
  return {
    quote: q, name: quoteName(q), items, fit, currency,
    total: q.totalOverride ?? q.extraction!.total,
    failedMusts, unknownMusts,
    niceMet: items.filter((c) => !musts[c.id] && c.status === 'ok').length,
    usableWh: items.find((c) => c.id === 'battery')?.facts.usableWh ?? 0,
  }
}

const byTotal = (a: Scored, b: Scored) => a.total - b.total
const byFitsOrder = (a: Scored, b: Scored) => a.total - b.total || b.niceMet - a.niceMet || b.usableWh - a.usableWh

/** Ranks the read quotes against the kit. Pure; recomputed on every render. */
export function compareQuotes(kit: KitNeeds, musts: Musts, quotes: readonly QuoteView[]): Verdict {
  const rankable = quotes.filter(isRankable)
  const currency = mainCurrency(rankable)
  const inCurrency = rankable.filter((q) => q.extraction!.currency === currency)
  const unranked: UnrankedQuote[] = quotes
    .filter((q) => !inCurrency.includes(q))
    .map((q) => ({ quote: q, name: quoteName(q), reason: unrankedReason(q), currency: q.extraction?.currency ?? null }))

  const scored = currency === null ? [] : inCurrency.map((q) => score(q, kit, musts, currency))
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

  return {
    currency, ranked, unranked, best, nextFit, worthAsking, closest,
    mustCount: ITEM_IDS.filter((id) => musts[id]).length,
    readCount: quotes.filter((q) => !isPending(q.status) && q.status !== 'failed').length,
    failedCount: quotes.filter((q) => q.status === 'failed').length,
  }
}

/** Every quote has finished and none produced a reading: there is no verdict, only quotes to retry. */
export const nothingRead = (v: Verdict): boolean =>
  v.readCount === 0 && v.failedCount > 0 && !v.unranked.some((u) => u.reason === 'reading')
