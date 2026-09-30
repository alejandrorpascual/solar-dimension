import { trq, type Dictionary } from '../i18n'
import { fmtKwh, fmtList, fmtMoney, fmtW } from '../i18n/format'
import type { RankedQuote, Verdict } from './quote-compare'
import type { ItemCheck, ItemId, ItemStatus, KitNeeds } from './quote-items'
import type { ProjectJobs } from './quote-jobs'
import { MAX_MB, QUOTE_LIMITS, type Rejection } from './quote-limits'
import type { QuoteStatus } from './quote-schema'

const SECONDS_PER_MINUTE = 60

export const money = (t: Dictionary, amount: number, currency: string): string => fmtMoney(amount, currency, t.locale)
const inlineList = (t: Dictionary, ids: readonly ItemId[]): string => fmtList(ids.map((id) => t.quoteItemsInline[id]), t.locale)
const signedMoney = (t: Dictionary, n: number, currency: string): string => `${n > 0 ? '+' : '−'}${money(t, Math.abs(n), currency)}`
const isBest = (r: RankedQuote, v: Verdict): boolean => v.best !== null && v.best.quote.id === r.quote.id

export function verdictHeading(t: Dictionary, v: Verdict): string {
  if (v.best) return trq(t, 'headingBest', { name: v.best.name })
  if (v.ranked.length > 0) return t.quotes.headingNone
  if (v.unranked.some((u) => u.reason === 'reading')) return t.quotes.headingReading
  return v.unranked.length > 0 ? t.quotes.headingNone : t.quotes.headingEmpty
}

export function verdictSubline(t: Dictionary, v: Verdict, kit: KitNeeds): string {
  if (v.best) {
    const total = money(t, v.best.total, v.best.currency)
    return v.ranked.length === 1
      ? trq(t, 'subBestOne', { total, musts: v.mustCount })
      : trq(t, 'subBest', { total, count: v.ranked.length, musts: v.mustCount })
  }
  if (v.closest) return trq(t, 'subNone', { name: v.closest.name, gap: gapText(t, v.closest, kit) })
  if (v.worthAsking.length > 0) return t.quotes.subUnclear
  return v.ranked.length === 0 && v.unranked.length === 0 ? t.quotes.emptyBody : ''
}

/** The first must-have a quote fails, in words: "its inverter is 3,560 W short". */
export function gapText(t: Dictionary, r: RankedQuote, kit: KitNeeds): string {
  const id = r.failedMusts[0]
  const c = r.items.find((i) => i.id === id)
  if (!id || !c) return ''
  if (c.status === 'missing') return trq(t, 'gapMissing', { item: t.quoteItemsInline[id] })
  if (id === 'inverter') {
    return c.facts.shortW ? trq(t, 'gapInverter', { w: fmtW(c.facts.shortW, t.locale) }) : trq(t, 'gapSurge', { w: fmtW(kit.surgeW, t.locale) })
  }
  if (id === 'battery') return trq(t, 'gapBattery', { kwh: fmtKwh(c.facts.shortWh ?? 0, t.locale) })
  if (id === 'cables') return trq(t, 'gapCables', { gauge: kit.cableGauge })
  if (id === 'fuse') return trq(t, 'gapFuse', { amps: kit.fuseA })
  return trq(t, 'gapMissing', { item: t.quoteItemsInline[id] })
}

export function reasonLine(t: Dictionary, r: RankedQuote, v: Verdict, kit: KitNeeds): string {
  if (isBest(r, v)) return t.quotes.reasonBest
  if (r.fit === 'fits') return trq(t, 'reasonFits', { delta: money(t, r.delta ?? 0, r.currency) })
  if (r.fit === 'unclear') return trq(t, 'reasonUnclear', { items: inlineList(t, r.unknownMusts) })
  return trq(t, 'reasonShort', { gap: gapText(t, r, kit) })
}

export function askText(t: Dictionary, r: RankedQuote, v: Verdict): string {
  const items = inlineList(t, r.unknownMusts)
  return v.best
    ? trq(t, 'askCheaper', { name: r.name, saving: money(t, v.best.total - r.total, r.currency), items })
    : trq(t, 'askNoBest', { name: r.name, items })
}

/** A question the user can paste into a message to the installer. */
export function questionText(t: Dictionary, r: RankedQuote): string {
  return trq(t, 'question', { name: r.name, items: inlineList(t, r.unknownMusts) })
}

export function fitLabel(t: Dictionary, r: RankedQuote, v: Verdict): string {
  if (isBest(r, v)) return t.quotes.bestFit
  if (r.fit === 'fits') return t.quotes.fitFits
  if (r.fit === 'unclear') return trq(t, 'fitUnclear', { count: r.unknownMusts.length })
  return t.quotes.fitShort
}

export function deltaText(t: Dictionary, r: RankedQuote): string {
  return r.delta === null || r.delta === 0 ? '' : trq(t, 'vsBest', { delta: signedMoney(t, r.delta, r.currency) })
}

export function markLabel(t: Dictionary, status: ItemStatus): string {
  const q = t.quotes
  return { ok: q.markOk, short: q.markShort, missing: q.notIncluded, unknown: q.notMentioned }[status]
}

/** A label and an optional detail for one item of a quote, shown in its checks. */
export function itemText(t: Dictionary, c: ItemCheck, kit: KitNeeds, currency: string): { label: string; detail: string | null } {
  const q = t.quotes
  const f = c.facts
  const L = t.locale
  const confirmed = f.confirmed ? q.confirmedByYou : null
  // An inverter with its watts but no start-up power is unknown for the kit, but it was mentioned.
  if (c.status === 'unknown' && c.id === 'inverter' && f.watts !== undefined) return { label: fmtW(f.watts, L), detail: q.surgeNotStated }
  if (c.status === 'unknown') return { label: q.notMentioned, detail: null }
  if (c.status === 'missing') {
    const optional = f.optionalPrice !== undefined ? trq(t, 'optionalPrice', { price: money(t, f.optionalPrice, currency) }) : null
    return { label: q.notIncluded, detail: confirmed ?? optional }
  }
  const short = c.status === 'short'
  switch (c.id) {
    case 'inverter': {
      const need = f.shortW ? trq(t, 'needsW', { w: fmtW(kit.runningW, L) }) : trq(t, 'needsSurge', { w: fmtW(kit.surgeW, L) })
      return { label: f.watts !== undefined ? fmtW(f.watts, L) : q.included, detail: short ? need : f.surgeUnknown ? q.surgeNotStated : confirmed }
    }
    case 'battery':
      return {
        label: f.usableWh !== undefined ? trq(t, 'usable', { kwh: fmtKwh(f.usableWh, L) }) : q.included,
        detail: short ? trq(t, 'shortKwh', { kwh: fmtKwh(f.shortWh ?? 0, L) }) : confirmed,
      }
    case 'charger':
    case 'wifi':
      return { label: q.included, detail: f.builtIn ? q.builtIn : f.amps !== undefined ? trq(t, 'amps', { amps: f.amps }) : confirmed }
    case 'cables':
      return { label: f.gauge ?? q.included, detail: short ? trq(t, 'needsGauge', { gauge: kit.cableGauge }) : f.sizeUnknown ? q.sizeNotStated : confirmed }
    case 'fuse':
      return {
        label: f.amps !== undefined ? trq(t, 'amps', { amps: f.amps }) : q.included,
        detail: short ? trq(t, 'needsAmps', { amps: kit.fuseA }) : f.sizeUnknown ? q.sizeNotStated : confirmed,
      }
    case 'installation':
      return { label: q.included, detail: confirmed }
    case 'warranty': {
      const years = (n: number | undefined) => (n === undefined ? '—' : trq(t, 'years', { n }))
      return { label: trq(t, 'warrantyYears', { battery: years(f.batteryYears), inverter: years(f.inverterYears) }), detail: confirmed }
    }
  }
}

export function fileStatusText(t: Dictionary, status: QuoteStatus | 'uploading'): string {
  const q = t.quotes
  return { uploading: q.stUploading, queued: q.stQueued, processing: q.stProcessing, ready: q.stReady, needs_review: q.stNeedsReview, failed: q.stFailed }[status]
}

export function rejectionText(t: Dictionary, r: Rejection): string {
  switch (r.code) {
    case 'type': return t.quotes.errType
    case 'size': return trq(t, 'errSize', { size: r.mb, limit: MAX_MB })
    case 'pages': return trq(t, 'errPages', { pages: r.pages, limit: QUOTE_LIMITS.maxPages })
    case 'encrypted': return t.quotes.errEncrypted
    case 'project_limit': return trq(t, 'errProjectLimit', { limit: QUOTE_LIMITS.perProject })
    case 'month_limit': return trq(t, 'errMonthLimit', { limit: QUOTE_LIMITS.perMonth })
    case 'not_saved': return t.quotes.errNotSaved
    case 'upload': return t.quotes.errUpload
  }
}

/** One line for a project's quotes, on the kit card and the project card. */
export function projectLine(t: Dictionary, j: ProjectJobs): string {
  if (j.pending > 0) return trq(t, 'lineReading', { done: j.done, total: j.total })
  if (j.kitEmpty) return t.quotes.kitEmptyTitle
  if (j.best) return trq(t, 'lineReady', { best: `${j.best.name} · ${money(t, j.best.total, j.best.currency)}` })
  const toCheck = j.failed + j.needsReview
  return toCheck > 0 ? trq(t, 'lineCheck', { count: toCheck }) : t.quotes.lineNoFit
}

export function etaText(t: Dictionary, seconds: number): string {
  return seconds < SECONDS_PER_MINUTE ? trq(t, 'etaSeconds', { n: seconds }) : trq(t, 'etaMinutes', { n: Math.ceil(seconds / SECONDS_PER_MINUTE) })
}
