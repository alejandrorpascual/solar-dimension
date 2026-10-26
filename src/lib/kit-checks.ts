import { applianceName, tr, type Dictionary, type Locale } from '../i18n'
import { fmtInt, fmtList, fmtW } from '../i18n/format'
import type { ChemistryId } from './catalog'
import { shareLabel } from './kit-parts'
import type { SelectedItem, SizingResult, Warning, WarningCode } from './sizing'

export type CheckId = 'surge' | 'batteryContinuous' | 'batteryPeak' | 'parallel' | 'fuse' | 'cable'
export const CHECK_IDS: readonly CheckId[] = ['surge', 'batteryContinuous', 'batteryPeak', 'parallel', 'fuse', 'cable']

/**
 * Which warnings fail each check; a warning not listed here is a general note, shown apart from the checks. `surge` is
 * the check shown as "Inverter size": it owns the running-load warning as well as the start-up one. Whether the
 * inverter is sold for the bank voltage, or has to be split-phase, stays a note.
 */
export const CHECK_WARNINGS: Record<CheckId, readonly WarningCode[]> = {
  surge: ['inverterUndersized', 'surgeDuration'],
  batteryContinuous: ['bankDischarge'],
  batteryPeak: ['bankPeak'],
  parallel: ['parallelStrings'],
  fuse: ['fuseVoltage', 'fuseAboveBank', 'fuseAboveCable', 'fuseSurge', 'fuseInterrupt'],
  cable: ['highCurrent', 'cableDrop', 'startupDrop', 'cableAmbient', 'cableUndersized'],
}
const CHECKED_CODES = new Set<WarningCode>(Object.values(CHECK_WARNINGS).flat())

export type CheckStatus = 'pass' | 'warn'
/** One engineering check, ready to print: its name, whether it passes, and the lines that say why. */
export interface KitCheck { id: CheckId; name: string; status: CheckStatus; lines: string[] }

const KA = 1000

/** What a warning's wording needs from the kit: its appliances, and its chemistry, which decides whether the bank has a BMS to name. */
export interface WarningKit { items: readonly SelectedItem[]; chemistry: ChemistryId }

/**
 * The warning in the user's language, with the appliance, or each one a note covers, named as the catalog names it
 * there, and the bank worded for the kit's chemistry. The kit is required whole, so no caller can leave the chemistry out.
 */
export function warningText(t: Dictionary, w: Warning, kit: WarningKit): string {
  const { items, chemistry } = kit
  const { itemId, itemIds } = w.params
  const item = items.find((i) => i.id === itemId)
  const listed = itemIds ? fmtList(items.filter((i) => itemIds.includes(i.id)).map((i) => applianceName(t, i)), t.locale) : undefined
  const itemName = listed ?? (item ? applianceName(t, item) : w.params.itemName)
  return t.warnings[w.code]({ ...w.params, itemName, chemistry })
}

/** A key that tells two warnings of the same code apart (two split-phase appliances, or two cable rows, say). */
export const warningKey = (w: Warning): string =>
  `${w.code}:${w.params.itemId ?? ''}:${w.params.strings ?? ''}:${w.params.fuseA ?? ''}:${w.params.conductor ?? ''}`

/** Warnings no check owns: voltage fit, a dominant load, split phase, appliances the catalog could not load. */
export function uncheckedWarnings(r: SizingResult): Warning[] {
  return r.warnings.filter((w) => !CHECKED_CODES.has(w.code))
}

/** Those notes in the reader's language: they travel with the kit onto the sheet, the image and the CSV. */
export const kitNotes = (t: Dictionary, r: SizingResult): string[] => uncheckedWarnings(r).map((w) => warningText(t, w, r))

export const isFailing = (c: KitCheck): boolean => c.status === 'warn'

const NAME_KEY: Record<CheckId, 'checkSurge' | 'checkBatteryContinuous' | 'checkBatteryPeak' | 'checkParallel' | 'checkFuse' | 'checkCable'> = {
  surge: 'checkSurge', batteryContinuous: 'checkBatteryContinuous', batteryPeak: 'checkBatteryPeak', parallel: 'checkParallel', fuse: 'checkFuse', cable: 'checkCable',
}

/** The two start-up pass lines of the inverter size check, for one inverter or a set: with the seconds a surge lasts, or without when nothing surges. */
const SURGE_PASS_KEY = {
  one: { surge: 'checkSurgeOk', none: 'checkSurgeOkNoStart' },
  many: { surge: 'checkSurgeOkMany', none: 'checkSurgeOkManyNoStart' },
} as const

function passLine(t: Dictionary, r: SizingResult, id: CheckId, locale: Locale): string {
  const b = r.battery!
  const c = r.cable
  const inv = r.inverter
  const w = (n: number) => fmtW(n, locale)
  const a = (n: number) => fmtInt(Math.round(n), locale)
  // No appliance starts above its running watts: there is no surge, so no seconds to print.
  const hasSurge = r.surgeSeconds > 0
  switch (id) {
    case 'surge':
      return tr(t, SURGE_PASS_KEY[inv.count > 1 ? 'many' : 'one'][hasSurge ? 'surge' : 'none'], {
        running: w(r.runningW), inverter: w(inv.w), count: inv.count, unit: w(inv.unitW), peak: w(r.surgeW), seconds: r.surgeSeconds, rating: w(inv.surgeRatedW),
      })
    case 'batteryContinuous':
      return tr(t, inv.count > 1 ? 'checkBatteryContinuousOkMany' : 'checkBatteryContinuousOk', { bankA: a(b.bankContinuousA), needA: a(inv.continuousA), count: inv.count })
    case 'batteryPeak':
      return tr(t, hasSurge ? 'checkBatteryPeakOk' : 'checkBatteryPeakOkNoStart', { bankA: a(b.bankPeakA), needA: a(r.startupA), seconds: r.surgeSeconds })
    case 'parallel':
      return tr(t, b.parallel > 1 ? 'checkParallelOk' : 'checkParallelSingle', { parallel: b.parallel, max: b.unit.maxParallel })
    case 'fuse':
      return tr(t, 'checkFuseOk', { amps: r.fuse.a, class: r.fuse.class, ampacity: a(c.ampacity), aic: r.fuse.aicA / KA, fault: a(b.bankShortCircuitA), startA: a(c.startupPerRunA) })
    case 'cable':
      return tr(t, 'checkCableOk', {
        gauge: c.runs > 1 ? `${c.runs} × ${c.gauge}` : c.gauge, ampacity: a(c.ampacity), ambient: c.ambientC, bundled: c.bundled ? t.ui.cableBundledShort : '',
        designA: a(c.designPerRunA), perRun: shareLabel(r, t), runDrop: c.dropPct, drop: c.startupDropPct,
      })
  }
}

/** Which units were assumed to start together, as one line under the inverter size check (id `surge`). */
function contributorsLine(t: Dictionary, r: SizingResult, locale: Locale): string | null {
  const starters = r.surgeProfile.starters
  if (starters.length === 0) return null
  const named = starters.map((s) => {
    const item = r.items.find((i) => i.id === s.itemId)
    return `${fmtW(s.delta, locale)} (${item ? applianceName(t, item) : s.itemName})`
  })
  return tr(t, 'checkSurgeContributors', { running: fmtW(r.runningW, locale), list: fmtList(named, locale) })
}

/** The warnings that fail one check. */
const failingWarnings = (r: SizingResult, id: CheckId): Warning[] => r.warnings.filter((w) => CHECK_WARNINGS[id].includes(w.code))

/** The six checks for a sized kit, in order; empty when there is nothing to check. */
export function kitChecks(t: Dictionary, r: SizingResult, locale: Locale): KitCheck[] {
  if (r.empty || !r.battery) return []
  return CHECK_IDS.map((id) => {
    const failing = failingWarnings(r, id)
    const status: CheckStatus = failing.length > 0 ? 'warn' : 'pass'
    const main = status === 'pass' ? [passLine(t, r, id, locale)] : failing.map((w) => warningText(t, w, r))
    const extra = id === 'surge' ? contributorsLine(t, r, locale) : null
    return { id, name: t.ui[NAME_KEY[id]], status, lines: extra ? [...main, extra] : main }
  })
}

/** The checks a kit fails, in order; none when there is nothing to check. */
export function failingChecks(r: SizingResult): CheckId[] {
  if (r.empty || !r.battery) return []
  return CHECK_IDS.filter((id) => failingWarnings(r, id).length > 0)
}

/** "2 checks need attention" in the reader's language, shown before export; null when every check passes. */
export function attentionLine(t: Dictionary, r: SizingResult): string | null {
  const count = failingChecks(r).length
  if (count === 0) return null
  return tr(t, count === 1 ? 'checksAttentionOne' : 'checksAttentionMany', { count })
}
