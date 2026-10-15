import { trq, type Dictionary, type QuoteKey } from '../i18n'
import { checkExtraction, hasTotal, isFixedByTotal, linesWithTax } from './quote-checks'
import { fmtDecimal, fmtKwh, fmtList, fmtMoney, fmtW } from '../i18n/format'
import { entryKey, entryName, nothingRead, quoteSubtitle, type EntryOption, type QuoteView, type RankedQuote, type UnrankedQuote, type Verdict } from './quote-compare'
import { HIGHEST_DOD_CHEMISTRY, LOWEST_DOD_CHEMISTRY, STRIP_ITEMS, type ItemCheck, type ItemFacts, type ItemId, type ItemStatus, type KitNeeds } from './quote-items'
import type { ProjectJobs } from './quote-jobs'
import { MAX_MB, QUOTE_LIMITS, type Rejection } from './quote-limits'
import type { QuoteExtraction, QuoteStatus } from './quote-schema'
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
    const count = new Set(v.ranked.map((r) => r.quote.id)).size
    return count === 1
      ? trq(t, 'subBestOne', { total, musts: v.mustCount })
      : trq(t, 'subBest', { total, count, musts: v.mustCount })
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
  if (id === 'panels') return trq(t, 'gapPanels', { w: fmtW(c.facts.shortArrayW ?? 0, t.locale) })
  if (id === 'cables') return trq(t, 'gapCables', { gauge: kit.cableGauge })
  if (id === 'fuse') {
    return c.facts.maxA !== undefined
      ? trq(t, 'gapFuseCable', { amps: c.facts.amps ?? 0, gauge: c.facts.gauge ?? '' })
      : trq(t, 'gapFuse', { amps: kit.fuseA })
  }
  return trq(t, 'gapMissing', { item: t.quoteItemsInline[id] })
}

/**
 * An unknown item the quote does mention, without enough to judge it: a size, a class, a count or a chemistry. The
 * others it doesn't mention at all. The two read differently: "doesn't mention a battery charger", "doesn't confirm the
 * size and number of the main cables".
 */
export const isUnclear = (c: ItemCheck): boolean => c.status === 'unknown' && c.source !== null

/** A quote's unknown must-haves, split into those it doesn't mention and those it leaves to confirm. */
function unknownGroups(r: RankedQuote): { unmentioned: ItemId[]; unclear: ItemCheck[] } {
  const unclear = r.items.filter((c) => isUnclear(c) && r.unknownMusts.includes(c.id))
  return { unmentioned: r.unknownMusts.filter((id) => !unclear.some((c) => c.id === id)), unclear }
}

/** What is left open about a fuse the quote mentions, as a phrase to confirm. */
function fuseConfirm(t: Dictionary, f: ItemFacts): string {
  if (f.sizeUnknown) return t.quotes.confirmFuseRating
  if (f.fuseClass !== undefined) return trq(t, 'confirmFuseClass', { class: f.fuseClass, kitClass: f.kitClass ?? '' })
  if (f.classUnstated) return trq(t, 'confirmFuseClassUnstated', { kitClass: f.kitClass ?? '' })
  if (f.runsUnstated) return trq(t, 'confirmFuseRuns', { amps: f.amps ?? 0, runs: f.runs ?? 0, gauge: f.gauge ?? '' })
  return trq(t, 'confirmFuseCount', { amps: f.amps ?? 0 })
}

/** What is left open about an item the quote mentions, as a phrase: "the size of the main cables". */
function confirmPhrase(t: Dictionary, c: ItemCheck): string {
  const q = t.quotes
  const f = c.facts
  switch (c.id) {
    case 'inverter': return f.watts === undefined ? q.confirmInverterPower : q.confirmInverterSurge
    case 'battery':
      if (f.capacityPartial) return q.confirmBatteryAll
      return f.usableLowWh === undefined ? q.confirmBatteryCapacity : q.confirmBatteryChemistry
    case 'panels': return q.confirmPanelSize
    case 'cables': return f.runsUnstated ? trq(t, 'confirmCableRuns', { runs: f.runs ?? 0, gauge: f.gauge ?? '' }) : q.confirmCableSize
    case 'fuse': return fuseConfirm(t, f)
    default: return t.quoteItemsInline[c.id]
  }
}
const confirmList = (t: Dictionary, items: readonly ItemCheck[]): string => fmtList(items.map((c) => confirmPhrase(t, c)), t.locale)

export function reasonLine(t: Dictionary, r: RankedQuote, v: Verdict, kit: KitNeeds): string {
  if (isBest(r, v)) return t.quotes.reasonBest
  if (r.fit === 'fits') return trq(t, 'reasonFits', { delta: money(t, r.delta ?? 0, r.currency) })
  if (r.fit === 'unclear') {
    const { unmentioned, unclear } = unknownGroups(r)
    return [
      ...(unmentioned.length > 0 ? [trq(t, 'reasonUnclear', { items: inlineList(t, unmentioned) })] : []),
      ...(unclear.length > 0 ? [trq(t, 'reasonToConfirm', { items: confirmList(t, unclear) })] : []),
    ].join(' ')
  }
  return trq(t, 'reasonShort', { gap: gapText(t, r, kit) })
}

/** What keeps an unclear quote from fitting, as one clause: "doesn't mention a battery charger and doesn't confirm …". */
function gapsClause(t: Dictionary, r: RankedQuote): string {
  const { unmentioned, unclear } = unknownGroups(r)
  return fmtList([
    ...(unmentioned.length > 0 ? [trq(t, 'gapsMention', { items: inlineList(t, unmentioned) })] : []),
    ...(unclear.length > 0 ? [trq(t, 'gapsConfirm', { items: confirmList(t, unclear) })] : []),
  ], t.locale)
}

export function askText(t: Dictionary, r: RankedQuote, v: Verdict): string {
  const gaps = gapsClause(t, r)
  return v.best
    ? trq(t, 'askCheaper', { name: entryName(r), saving: money(t, v.best.total - r.total, r.currency), gaps })
    : trq(t, 'askNoBest', { name: entryName(r), gaps })
}

/** A question the user can paste into a message to the installer: what the quote leaves out, then what it leaves open. */
export function questionText(t: Dictionary, r: RankedQuote): string {
  const { unmentioned, unclear } = unknownGroups(r)
  if (unmentioned.length === 0) return trq(t, 'questionConfirm', { name: r.name, items: confirmList(t, unclear) })
  const ask = trq(t, 'question', { name: r.name, items: inlineList(t, unmentioned) })
  return unclear.length > 0 ? `${ask} ${trq(t, 'questionAlso', { items: confirmList(t, unclear) })}` : ask
}

export function fitLabel(t: Dictionary, r: RankedQuote, v: Verdict): string {
  if (isBest(r, v)) return t.quotes.bestFit
  if (r.fit === 'fits') return t.quotes.fitFits
  if (r.fit === 'unclear') return trq(t, 'fitUnclear', { count: r.unknownMusts.length })
  return t.quotes.fitShort
}

/** A ranked quote priced by the total the user typed, not the one read: its card says so. */
export const isTotalTyped = (r: RankedQuote): boolean => r.optionId === null && r.quote.totalOverride !== null

/**
 * A battery-only kit isn't checked for panels, so a quote that includes them says so: it explains the price. Panels
 * that don't all state their wattage are named without a figure.
 */
export function extraPanelsText(t: Dictionary, r: RankedQuote, kit: KitNeeds): string | null {
  if (kit.arrayW > 0 || r.panelsW === 0) return null
  return r.panelsW === null ? t.quotes.alsoPanelsUnsized : trq(t, 'alsoPanels', { w: fmtW(r.panelsW, t.locale) })
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
  if (isUnclear(c)) return q.markUnclear
  return { ok: q.markOk, short: q.markShort, missing: q.notIncluded, unknown: q.notMentioned }[c.status]
}

/** A label and an optional detail for one item of a quote, shown in its checks. */
export function itemText(t: Dictionary, c: ItemCheck, kit: KitNeeds, currency: string): { label: string; detail: string | null } {
  const q = t.quotes
  const f = c.facts
  const L = t.locale
  const confirmed = f.confirmed ? q.confirmedByYou : null
  if (isSurgeUnstated(c)) return { label: fmtW(f.watts ?? 0, L), detail: q.surgeNotStated }
  if (isUnclear(c)) return unclearText(t, c, kit)
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
        detail: short ? trq(t, 'shortKwh', { kwh: fmtKwh(f.shortWh ?? 0, L) }) : confirmed ?? batteryMath(t, f),
      }
    case 'panels':
      return { label: f.arrayW !== undefined ? fmtW(f.arrayW, L) : q.included, detail: short ? trq(t, 'needsW', { w: fmtW(kit.arrayW, L) }) : confirmed }
    case 'charger':
    case 'wifi':
      return { label: q.included, detail: f.builtIn ? q.builtIn : f.amps !== undefined ? trq(t, 'amps', { amps: f.amps }) : confirmed }
    case 'cables':
      return { label: f.gauge ?? q.included, detail: short ? trq(t, 'needsGauge', { gauge: kit.cableGauge }) : confirmed }
    case 'fuse':
      return { label: f.amps !== undefined ? trq(t, 'amps', { amps: f.amps }) : q.included, detail: short ? fuseShortText(t, f, kit) : confirmed }
    case 'installation':
      return { label: q.included, detail: confirmed }
    case 'warranty': {
      const years = (n: number | undefined) => (n === undefined ? '—' : trq(t, 'years', { n }))
      return { label: trq(t, 'warrantyYears', { battery: years(f.batteryYears), inverter: years(f.inverterYears) }), detail: confirmed }
    }
  }
}

/** How a bank's usable energy was counted: "9.6 kWh × 85% depth of discharge"; null when its lines mix depths. */
function batteryMath(t: Dictionary, f: ItemFacts): string | null {
  if (f.nominalWh === undefined || f.dod === undefined) return null
  const params = { nominal: fmtKwh(f.nominalWh, t.locale), pct: Math.round(f.dod * PERCENT) }
  return trq(t, f.dodAssumed ? 'batteryMathAssumed' : 'batteryMath', params)
}

function fuseShortText(t: Dictionary, f: ItemFacts, kit: KitNeeds): string {
  return f.maxA !== undefined ? trq(t, 'fuseAboveCable', { gauge: f.gauge ?? '', maxA: f.maxA }) : trq(t, 'needsAmps', { amps: kit.fuseA })
}

/** What a bank the quote mentions leaves open: its capacity, part of it, or its chemistry. */
function batteryOpen(t: Dictionary, f: ItemFacts): string {
  const kwh = (wh: number | undefined) => fmtKwh(wh ?? 0, t.locale)
  if (f.capacityPartial) return trq(t, 'capacityPartial', { kwh: kwh(f.usableLowWh) })
  if (f.usableLowWh === undefined) return t.quotes.capacityNotStated
  return trq(t, 'chemistryRange', {
    low: kwh(f.usableLowWh), high: kwh(f.usableHighWh),
    lowName: t.chemistries[LOWEST_DOD_CHEMISTRY], highName: t.chemistries[HIGHEST_DOD_CHEMISTRY],
  })
}

/** What a fuse the quote mentions leaves open: its rating, its class, the runs it needs, or how many fuses there are. */
function fuseOpen(t: Dictionary, f: ItemFacts, kit: KitNeeds): string {
  if (f.sizeUnknown) return t.quotes.sizeNotStated
  if (f.fuseClass !== undefined) return trq(t, 'fuseOtherClass', { class: f.fuseClass, kitClass: kit.fuseClass })
  if (f.classUnstated) return trq(t, 'fuseClassNotStated', { kitClass: kit.fuseClass })
  if (f.runsUnstated) return trq(t, 'fuseNeedsRuns', { runs: f.runs ?? 0, gauge: f.gauge ?? '' })
  return trq(t, 'kitListsFuses', { count: kit.fuseCount, amps: kit.fuseA, fuses: f.fuses ?? 0 })
}

/** An item the quote mentions without enough to judge it: what it says, and what is left to confirm. */
function unclearText(t: Dictionary, c: ItemCheck, kit: KitNeeds): { label: string; detail: string } {
  const q = t.quotes
  const f = c.facts
  switch (c.id) {
    case 'inverter': return { label: q.included, detail: q.powerNotStated }
    case 'battery': return { label: q.included, detail: batteryOpen(t, f) }
    case 'panels': return { label: f.arrayW ? fmtW(f.arrayW, t.locale) : q.included, detail: q.sizeNotStated }
    case 'cables':
      return f.runsUnstated ? { label: f.gauge ?? q.included, detail: trq(t, 'needsRuns', { runs: f.runs ?? 0 }) } : { label: q.included, detail: q.sizeNotStated }
    case 'fuse': return { label: f.amps !== undefined ? trq(t, 'amps', { amps: f.amps }) : q.included, detail: fuseOpen(t, f, kit) }
    default: return { label: q.included, detail: q.markUnclear }
  }
}

/**
 * The help above the enter-a-total form: the total is missing, or the amounts don't add up. A reading that still doesn't
 * hold once read again (takesTypedTotal) asks instead for the total as the quote writes it.
 */
export function totalHelp(t: Dictionary, u: UnrankedQuote): string {
  const x = u.quote.extraction
  if (x !== null && !isFixedByTotal(x)) return x.lines.length === 0 ? t.quotes.noLinesTotalHelp : t.quotes.misreadTotalHelp
  return u.reason === 'no_total' ? t.quotes.noTotalHelp : t.quotes.checkNumbersHelp
}

/** Why a reading waits to be read again rather than for a total: no lines were read, or the ones read don't hold together. */
export function misreadText(t: Dictionary, x: QuoteExtraction, canReadAgain: boolean): string {
  if (x.lines.length === 0) return canReadAgain ? t.quotes.noLinesHelp : t.quotes.noLinesHelpNoRetry
  return canReadAgain ? t.quotes.misreadHelp : t.quotes.misreadHelpNoRetry
}

/**
 * The total that was read, beside the empty field, and what the lines and tax add up to when the two disagree: the
 * field starts empty, so the figure that failed the check is never saved by one click. Null when no total was read.
 */
export function readTotalText(t: Dictionary, x: QuoteExtraction): string | null {
  if (!hasTotal(x.total)) return null
  const total = money(t, x.total, x.currency)
  const sum = linesWithTax(x)
  return checkExtraction(x).includes('total_mismatch') && sum > 0
    ? trq(t, 'totalReadLines', { total, sum: money(t, sum, x.currency) })
    : trq(t, 'totalRead', { total })
}

const SUBTITLE_SEPARATOR = ' · '

/**
 * A card's second line: for an option, which of the quote's options it is, its label and the file ("Option 2 of 2 ·
 * Inversor 10 kW · suna.pdf"); otherwise the file name. The file is left out when it already is the card's name.
 */
export function entrySubtitle(t: Dictionary, e: EntryOption & { quote: QuoteView }): string | null {
  if (e.optionId === null) return quoteSubtitle(e.quote)
  const n = (e.quote.extraction?.options.findIndex((o) => o.id === e.optionId) ?? 0) + 1
  return [trq(t, 'optionOf', { n, count: e.optionCount }), e.optionLabel, quoteSubtitle(e.quote)].filter(Boolean).join(SUBTITLE_SEPARATOR)
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

/** ok, short, missing, unknown: one coverage line per item status, with unknowns the quote mentions as their own line. */
export type CoverageKind = ItemStatus | 'unclear'
const COVERAGE: readonly { kind: CoverageKind; key: QuoteKey }[] = [
  { kind: 'ok', key: 'coverIncludes' }, { kind: 'short', key: 'coverShort' },
  { kind: 'missing', key: 'coverMissing' }, { kind: 'unclear', key: 'coverUnclear' }, { kind: 'unknown', key: 'coverUnknown' },
]
const coverageKind = (c: ItemCheck): CoverageKind => (isUnclear(c) ? 'unclear' : c.status)

/** What a quote says about the five strip items, one line per status, empty groups left out. */
export function coverageLines(t: Dictionary, items: readonly ItemCheck[]): { kind: CoverageKind; text: string }[] {
  const strip = items.filter((c) => STRIP_ITEMS.includes(c.id))
  return COVERAGE.flatMap(({ kind, key }) => {
    const ids: ItemId[] = strip.filter((c) => coverageKind(c) === kind).map((c) => c.id)
    if (ids.length === 0) return []
    return [{ kind, text: trq(t, key, { items: fmtList(ids.map((id) => t.quoteItemsList[id]), t.locale) }) }]
  })
}

const COVERAGE_SEPARATOR = ' · '
/** The coverage groups on one line, for a card where space is short. */
export function coverageMeta(t: Dictionary, items: readonly ItemCheck[]): string {
  return coverageLines(t, items).map((l) => l.text).join(COVERAGE_SEPARATOR)
}

/** Whether a quote waits for the user to type its total: a quote with options has no total form, it is read again instead. */
const waitsForTotal = (u: UnrankedQuote): boolean => u.optionCount === 0 && (u.reason === 'no_total' || u.reason === 'needs_review')

export function unrankedTitle(t: Dictionary, unranked: readonly UnrankedQuote[]): string {
  return unranked.length > 0 && unranked.every(waitsForTotal) ? t.quotes.unrankedNoTotal : t.quotes.unrankedTitle
}
