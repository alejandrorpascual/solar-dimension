import { applianceName, tr, type Dictionary, type Locale } from '../i18n'
import { fmtInt, fmtList, fmtW } from '../i18n/format'
import { SIZING } from './catalog'
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
  fuse: ['fuseAboveBank', 'fuseAboveCable', 'fuseSurge', 'fuseInterrupt'],
  cable: ['highCurrent', 'startupDrop', 'cableAmbient', 'cableUndersized'],
}
const CHECKED_CODES = new Set<WarningCode>(Object.values(CHECK_WARNINGS).flat())

export type CheckStatus = 'pass' | 'warn'
/** One engineering check, ready to print: its name, whether it passes, and the lines that say why. */
export interface KitCheck { id: CheckId; name: string; status: CheckStatus; lines: string[] }

const KA = 1000

/** The warning in the user's language, with the appliance named as the catalog names it there. */
export function warningText(t: Dictionary, w: Warning, items: readonly SelectedItem[]): string {
  const item = items.find((i) => i.id === w.params.itemId)
  const itemName = item ? applianceName(t, item) : w.params.itemName
  return t.warnings[w.code]({ ...w.params, itemName })
}

/** A key that tells two warnings of the same code apart (two split-phase appliances, or two cable rows, say). */
export const warningKey = (w: Warning): string =>
  `${w.code}:${w.params.itemId ?? ''}:${w.params.strings ?? ''}:${w.params.fuseA ?? ''}:${w.params.conductor ?? ''}`

/** Warnings no check owns: voltage fit, a dominant load, split phase, appliances the catalog could not load. */
export function uncheckedWarnings(r: SizingResult): Warning[] {
  return r.warnings.filter((w) => !CHECKED_CODES.has(w.code))
}

const NAME_KEY: Record<CheckId, 'checkSurge' | 'checkBatteryContinuous' | 'checkBatteryPeak' | 'checkParallel' | 'checkFuse' | 'checkCable'> = {
  surge: 'checkSurge', batteryContinuous: 'checkBatteryContinuous', batteryPeak: 'checkBatteryPeak', parallel: 'checkParallel', fuse: 'checkFuse', cable: 'checkCable',
}

function passLine(t: Dictionary, r: SizingResult, id: CheckId, locale: Locale): string {
  const b = r.battery!
  const c = r.cable
  const w = (n: number) => fmtW(n, locale)
  const a = (n: number) => fmtInt(Math.round(n), locale)
  const startupA = r.surgeW / r.volts / SIZING.INVERTER_EFF
  switch (id) {
    case 'surge':
      return tr(t, 'checkSurgeOk', { running: w(r.runningW), inverter: w(r.inverter.w), peak: w(r.surgeW), seconds: r.surgeSeconds, rating: w(r.inverter.surgeRatedW) })
    case 'batteryContinuous':
      return tr(t, 'checkBatteryContinuousOk', { bankA: a(b.bankContinuousA), needA: a(r.inverter.continuousA) })
    case 'batteryPeak':
      return tr(t, 'checkBatteryPeakOk', { bankA: a(b.bankPeakA), needA: a(startupA), seconds: r.surgeSeconds })
    case 'parallel':
      return b.parallel > 1 ? tr(t, 'checkParallelOk', { parallel: b.parallel, max: b.unit.maxParallel }) : t.ui.checkParallelSingle
    case 'fuse':
      return tr(t, 'checkFuseOk', { amps: r.fuse.a, class: r.fuse.class, ampacity: a(c.ampacity), aic: r.fuse.aicA / KA, startA: a(startupA / c.runs) })
    case 'cable':
      return tr(t, 'checkCableOk', {
        gauge: c.runs > 1 ? `${c.runs} × ${c.gauge}` : c.gauge, ampacity: a(c.ampacity), ambient: c.ambientC, bundled: c.bundled ? t.ui.cableBundledShort : '',
        designA: a(c.designPerRunA), perRun: c.runs > 1 ? t.ui.perRun : '', drop: c.startupDropPct,
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

/** The six checks for a sized kit, in order; empty when there is nothing to check. */
export function kitChecks(t: Dictionary, r: SizingResult, locale: Locale): KitCheck[] {
  if (r.empty || !r.battery) return []
  return CHECK_IDS.map((id) => {
    const failing = r.warnings.filter((w) => CHECK_WARNINGS[id].includes(w.code))
    const status: CheckStatus = failing.length > 0 ? 'warn' : 'pass'
    const main = status === 'pass' ? [passLine(t, r, id, locale)] : failing.map((w) => warningText(t, w, r.items))
    const extra = id === 'surge' ? contributorsLine(t, r, locale) : null
    return { id, name: t.ui[NAME_KEY[id]], status, lines: extra ? [...main, extra] : main }
  })
}
