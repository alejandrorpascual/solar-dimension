import { trq, type Dictionary, type QuoteKey } from '../i18n'
import { fmtDecimal, fmtKwh, fmtList, fmtMoney, fmtW } from '../i18n/format'
import { entryKey, entryName, nothingRead, quoteSubtitle, type EntryOption, type QuoteView, type RankedQuote, type UnrankedQuote, type Verdict } from './quote-compare'
import { STRIP_ITEMS, type ItemCheck, type ItemId, type ItemStatus, type KitNeeds } from './quote-items'
import type { ProjectJobs } from './quote-jobs'
import { MAX_MB, QUOTE_LIMITS, type Rejection } from './quote-limits'
import type { QuoteStatus } from './quote-schema'
import { SIZED_IDS, SIZING_ZONES, suggestedInverterW, type QuoteSizing, type SizedId, type Sizing, type SizingZone } from './quote-sizing'

const SECONDS_PER_MINUTE = 60

export const money = (t: Dictionary, amount: number, currency: string): string => fmtMoney(amount, currency, t.locale)
const inlineList = (t: Dictionary, ids: readonly ItemId[]): string => fmtList(ids.map((id) => t.quoteItemsInline[id]), t.locale)
const isBest = (r: RankedQuote, v: Verdict): boolean => v.best !== null && entryKey(v.best) === entryKey(r)

export function verdictHeading(t: Dictionary, v: Verdict): string {
  if (v.best) return trq(t, 'headingBest', { name: entryName(v.best) })
  if (v.ranked.length > 0) return t.quotes.headingNone
  if (v.unranked.some((u) => u.reason === 'reading')) return t.quotes.headingReading
  if (nothingRead(v)) return t.quotes.headingUnread
  return v.unranked.length > 0 ? t.quotes.headingNone : t.quotes.headingEmpty
}

export function verdictSubline(t: Dictionary, v: Verdict, kit: KitNeeds): string {
  if (v.best) {
    const total = money(t, v.best.total, v.best.currency)
    return v.ranked.length === 1
      ? trq(t, 'subBestOne', { total, musts: v.mustCount })
      : trq(t, 'subBest', { total, count: v.ranked.length, musts: v.mustCount })
  }
  if (v.closest) return trq(t, 'subNone', { name: entryName(v.closest), gap: gapText(t, v.closest, kit) })
  if (v.worthAsking.length > 0) return t.quotes.subUnclear
  if (nothingRead(v)) return t.quotes.subUnread
  return v.ranked.length === 0 && v.unranked.length === 0 ? t.quotes.emptyBody : ''
}

/**
 * The status line above the heading once reading is over: a ready verdict with how many quotes were read, or, when
 * none could be read, a warning with how many failed. Null while nothing has finished.
 */
export function verdictStatus(t: Dictionary, v: Verdict): { tone: 'ok' | 'warn'; label: string; meta: string | null } | null {
  if (v.readCount > 0) {
    return { tone: 'ok', label: t.quotes.verdictReady, meta: v.readCount === 1 ? t.quotes.readMetaOne : trq(t, 'readMeta', { count: v.readCount }) }
  }
  if (!nothingRead(v)) return null
  return { tone: 'warn', label: v.failedCount === 1 ? t.quotes.unreadOne : trq(t, 'unreadCount', { count: v.failedCount }), meta: null }
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
    ? trq(t, 'askCheaper', { name: entryName(r), saving: money(t, v.best.total - r.total, r.currency), items })
    : trq(t, 'askNoBest', { name: entryName(r), items })
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
  if (r.delta === null || r.delta === 0) return ''
  return trq(t, r.delta > 0 ? 'moreThanBest' : 'lessThanBest', { amount: money(t, Math.abs(r.delta), r.currency) })
}

/** An inverter with its watts but no start-up power: mentioned, yet unknown for the kit. */
const isSurgeUnstated = (c: ItemCheck): boolean => c.status === 'unknown' && c.id === 'inverter' && c.facts.watts !== undefined

/** The accessible name of a check's icon. */
export function markLabel(t: Dictionary, c: ItemCheck): string {
  const q = t.quotes
  if (isSurgeUnstated(c)) return q.surgeNotStated
  return { ok: q.markOk, short: q.markShort, missing: q.notIncluded, unknown: q.notMentioned }[c.status]
}

/** A label and an optional detail for one item of a quote, shown in its checks. */
export function itemText(t: Dictionary, c: ItemCheck, kit: KitNeeds, currency: string): { label: string; detail: string | null } {
  const q = t.quotes
  const f = c.facts
  const L = t.locale
  const confirmed = f.confirmed ? q.confirmedByYou : null
  if (isSurgeUnstated(c)) return { label: fmtW(f.watts ?? 0, L), detail: q.surgeNotStated }
  if (c.status === 'unknown') return { label: q.notMentioned, detail: null }
  if (c.status === 'missing') {
    const optional = f.optionalPrice !== undefined ? trq(t, 'optionalPrice', { price: money(t, f.optionalPrice, currency) }) : null
    return { label: q.notIncluded, detail: confirmed ?? optional }
  }
  const short = c.status === 'short'
  switch (c.id) {
    case 'inverter': {
      const need = f.shortW ? trq(t, 'needsW', { w: fmtW(kit.runningW, L) }) : trq(t, 'needsSurge', { w: fmtW(kit.surgeW, L) })
      // The user's confirmation wins over what the quote leaves unsaid.
      const unstated = f.surgeUnknown ? q.surgeNotStated : null
      return { label: f.watts !== undefined ? fmtW(f.watts, L) : q.included, detail: short ? need : confirmed ?? unstated }
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

/** The help above the enter-a-total form: the total is missing, or the amounts don't add up. */
export function totalHelp(t: Dictionary, reason: 'needs_review' | 'no_total'): string {
  return reason === 'no_total' ? t.quotes.noTotalHelp : t.quotes.checkNumbersHelp
}

const SUBTITLE_SEPARATOR = ' · '

/**
 * A card's second line: for an option, which of the quote's options it is, its label and the file ("Option 2 of 2 ·
 * Inversor 10 kW · suna.pdf"); otherwise the file name, unless it already is the card's name.
 */
export function entrySubtitle(t: Dictionary, e: EntryOption & { quote: QuoteView }): string | null {
  if (e.optionId === null) return quoteSubtitle(e.quote)
  const n = (e.quote.extraction?.options.findIndex((o) => o.id === e.optionId) ?? 0) + 1
  return [trq(t, 'optionOf', { n, count: e.optionCount }), e.optionLabel, e.quote.fileName].filter(Boolean).join(SUBTITLE_SEPARATOR)
}

/** Deleting a quote with options removes every option's card with the file, so the confirmation says how many. */
export function deleteConfirmText(t: Dictionary, optionCount: number): string {
  return optionCount > 0 ? trq(t, 'deleteConfirmOptions', { count: optionCount }) : t.quotes.deleteConfirm
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
    case 'unverified': return t.quotes.lockedNote
    case 'daily_limit': return t.quotes.errDailyLimit
  }
}

/** One line for a project's quotes, on the kit card and the project card. */
export function projectLine(t: Dictionary, j: ProjectJobs): string {
  if (j.pending > 0) return trq(t, 'lineReading', { done: j.done, total: j.total })
  if (j.kitEmpty) return t.quotes.kitEmptyTitle
  if (j.best) return trq(t, 'lineReady', { best: `${entryName(j.best)} · ${money(t, j.best.total, j.best.currency)}` })
  const toCheck = j.failed + j.needsReview
  return toCheck > 0 ? trq(t, 'lineCheck', { count: toCheck }) : t.quotes.lineNoFit
}

export function etaText(t: Dictionary, seconds: number): string {
  return seconds < SECONDS_PER_MINUTE ? trq(t, 'etaSeconds', { n: seconds }) : trq(t, 'etaMinutes', { n: Math.ceil(seconds / SECONDS_PER_MINUTE) })
}

const PERCENT = 100
const ZONE_KEY: Record<SizingZone, QuoteKey> = { short: 'zoneShort', just: 'zoneJust', roomy: 'zoneRoomy', over: 'zoneOver' }
/** Short percents round down, so a quote just under the need never reads as 100 %. */
const shortPct = (ratio: number): number => Math.floor(ratio * PERCENT)
/** Roomy starts just above the snug edge, so its percent never reads as the legend's "up to 30%". */
const ROOMY_MIN_PCT = Math.round((SIZING_ZONES.JUST_MAX - 1) * PERCENT) + 1
/** Below this a multiple keeps two decimals ("1.15×"), so one just over double never rounds to "2.0×". */
const ONE_DECIMAL_FROM = SIZING_ZONES.ROOMY_MAX + 0.05
const timesText = (t: Dictionary, ratio: number): string => fmtDecimal(ratio, ratio >= ONE_DECIMAL_FROM ? 1 : 2, t.locale)
const sizedAmount = (t: Dictionary, id: SizedId, n: number): string => (id === 'inverter' ? fmtW(n, t.locale) : fmtKwh(n, t.locale))

export const zoneName = (t: Dictionary, zone: SizingZone): string => t.quotes[ZONE_KEY[zone]]

/** How far a component lands from the kit's need: "3.1× what it needs", "+19%, right-sized", "47% of what it needs". */
export function zonePill(t: Dictionary, s: Sizing): string {
  if (s.zone === 'short') return trq(t, 'pillShort', { pct: shortPct(s.ratio) })
  if (s.zone === 'over') return trq(t, 'pillOver', { x: timesText(t, s.ratio) })
  const extra = Math.round((s.ratio - 1) * PERCENT)
  if (s.zone === 'roomy') return trq(t, 'pillRoomy', { pct: Math.max(extra, ROOMY_MIN_PCT) })
  return extra === 0 ? t.quotes.pillExact : trq(t, 'pillJust', { pct: extra })
}

/** The value beside a mini bar: a multiple from 1×, a percent below. */
export function ratioLabel(t: Dictionary, ratio: number): string {
  return ratio < 1 ? trq(t, 'ratioPct', { pct: shortPct(ratio) }) : trq(t, 'ratioTimes', { x: timesText(t, ratio) })
}

export function gaugeTitle(t: Dictionary, id: SizedId, s: Sizing): string {
  return id === 'inverter' ? trq(t, 'gaugeInverter', { w: fmtW(s.have, t.locale) }) : trq(t, 'gaugeBattery', { kwh: fmtKwh(s.have, t.locale) })
}

/** The gauge's accessible name: the numbers and the zone in words. */
export function gaugeLabel(t: Dictionary, id: SizedId, s: Sizing): string {
  return trq(t, 'gaugeLabel', {
    item: t.quoteItemsShort[id], have: sizedAmount(t, id, s.have), need: sizedAmount(t, id, s.need),
    zone: zoneName(t, s.zone).toLocaleLowerCase(t.locale),
  })
}

export function gaugeLegend(t: Dictionary): string {
  return trq(t, 'gaugeLegend', { pct: Math.round((SIZING_ZONES.JUST_MAX - 1) * PERCENT) })
}

/**
 * Advice to ask for a smaller inverter: only when the quoted one is more than double what the kit runs, and a size that
 * still starts the kit is actually smaller than it.
 */
export function oversizeTip(t: Dictionary, kit: KitNeeds, sizing: QuoteSizing): string | null {
  const suggested = suggestedInverterW(kit)
  if (sizing.inverter?.zone !== 'over' || suggested >= sizing.inverter.have) return null
  return trq(t, 'oversizeTip', { w: fmtW(suggested, t.locale) })
}

/** The sizing bars as one sentence for screen readers; empty when the quote states neither size. */
export function sizingSentence(t: Dictionary, sizing: QuoteSizing): string {
  return SIZED_IDS.flatMap((id) => {
    const s = sizing[id]
    return s ? [`${gaugeLabel(t, id, s)}.`] : []
  }).join(' ')
}

/** ok, short, missing, unknown: one coverage line per item status. */
export type CoverageKind = ItemStatus
const COVERAGE: readonly { kind: CoverageKind; key: QuoteKey }[] = [
  { kind: 'ok', key: 'coverIncludes' }, { kind: 'short', key: 'coverShort' },
  { kind: 'missing', key: 'coverMissing' }, { kind: 'unknown', key: 'coverUnknown' },
]

/** What a quote says about the five strip items, one line per status, empty groups left out. */
export function coverageLines(t: Dictionary, items: readonly ItemCheck[]): { kind: CoverageKind; text: string }[] {
  const strip = items.filter((c) => STRIP_ITEMS.includes(c.id))
  return COVERAGE.flatMap(({ kind, key }) => {
    const ids: ItemId[] = strip.filter((c) => c.status === kind).map((c) => c.id)
    if (ids.length === 0) return []
    return [{ kind, text: trq(t, key, { items: fmtList(ids.map((id) => t.quoteItemsList[id]), t.locale) }) }]
  })
}

const COVERAGE_SEPARATOR = ' · '
/** The coverage groups on one line, for a card where space is short. */
export function coverageMeta(t: Dictionary, items: readonly ItemCheck[]): string {
  return coverageLines(t, items).map((l) => l.text).join(COVERAGE_SEPARATOR)
}

const waitsForTotal = (u: UnrankedQuote): boolean => u.reason === 'no_total' || u.reason === 'needs_review'

export function unrankedTitle(t: Dictionary, unranked: readonly UnrankedQuote[]): string {
  return unranked.length > 0 && unranked.every(waitsForTotal) ? t.quotes.unrankedNoTotal : t.quotes.unrankedTitle
}
