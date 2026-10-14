import { trq, type Dictionary } from '../i18n'
import { fmtDecimal, fmtList, fmtW } from '../i18n/format'
import type { Caveat } from './quote-caveats'
import type { RankedQuote } from './quote-compare'
import { LOWEST_DOD_CHEMISTRY, type KitNeeds } from './quote-items'
import { money } from './quote-text'

const WH_PER_KWH = 1000

/** One caveat in full, as the best card lists it. */
export function caveatText(t: Dictionary, c: Caveat, kit: KitNeeds): string {
  const L = t.locale
  switch (c.id) {
    case 'surge_unstated': return t.quotes.caveatSurge
    case 'no_headroom': return trq(t, 'caveatHeadroom', { need: fmtW(c.needW, L) })
    case 'confirmed': return trq(t, 'caveatConfirmed', { item: t.quoteItems[c.item] })
    case 'chemistry_unstated': return trq(t, 'caveatChemistryUnstated', { lowName: t.chemistries[LOWEST_DOD_CHEMISTRY] })
    case 'chemistry_differs': return trq(t, 'caveatChemistryDiffers', { chemistry: t.chemistries[c.chemistry], kitChemistry: t.chemistries[kit.chemistry] })
    case 'bank_voltage': return trq(t, 'caveatBankVoltage', { volts: c.volts, kitVolts: kit.volts })
    case 'inverter_voltage': return trq(t, 'caveatInverterVoltage', { volts: c.volts, kitVolts: kit.volts })
    case 'tax_unstated': return t.quotes.caveatTax
    case 'total_typed': return t.quotes.caveatTyped
  }
}

/** One caveat in a word or two, for a row's "Confirm first" line. */
function caveatShort(t: Dictionary, c: Caveat): string {
  const q = t.quotes
  switch (c.id) {
    case 'surge_unstated': return q.caveatShortSurge
    case 'no_headroom': return q.caveatShortHeadroom
    case 'confirmed': return trq(t, 'caveatShortConfirmed', { item: t.quoteItemsList[c.item] })
    case 'chemistry_unstated':
    case 'chemistry_differs': return q.caveatShortChemistry
    case 'bank_voltage': return q.caveatShortBankVoltage
    case 'inverter_voltage': return q.caveatShortInverterVoltage
    case 'tax_unstated': return q.caveatShortTax
    case 'total_typed': return q.caveatShortTyped
  }
}

/** A row's caveats on one line: "Confirm first: start-up power and tax"; null with none. */
export function caveatsLine(t: Dictionary, caveats: readonly Caveat[]): string | null {
  if (caveats.length === 0) return null
  const words = [...new Set(caveats.map((c) => caveatShort(t, c)))]
  return trq(t, 'caveatsLine', { items: fmtList(words, t.locale) })
}

/**
 * What the quote's bank gives at the kit's load: the hours the asked-for window scales to, and the price per usable
 * kWh. Only for a bank whose usable energy is known: one that passes or falls short on what it states.
 */
export function backupText(t: Dictionary, r: RankedQuote, kit: KitNeeds): string | null {
  const battery = r.items.find((c) => c.id === 'battery')
  const usableWh = battery?.status === 'ok' || battery?.status === 'short' ? battery.facts.usableWh : undefined
  if (usableWh === undefined || !(usableWh > 0) || !(kit.usableWh > 0)) return null
  const hours = (kit.hours * usableWh) / kit.usableWh
  return trq(t, 'backupLine', {
    hours: fmtDecimal(hours, 1, t.locale),
    asked: Number.isInteger(kit.hours) ? kit.hours : fmtDecimal(kit.hours, 1, t.locale),
    price: money(t, r.total / (usableWh / WH_PER_KWH), r.currency),
  })
}
