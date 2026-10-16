import { SIZING, type ChemistryId } from './catalog'
import { statesTax } from './quote-checks'
import type { ItemCheck, ItemId, KitNeeds, Musts } from './quote-items'
import type { QuoteExtraction, QuoteLine } from './quote-schema'

/**
 * What a quote that meets every must-have still leaves for the user to confirm: facts the verdict already has, none of
 * which fails a must-have. They never change which quote is cheapest; they decide whether the cheapest is called the
 * best fit or "the cheapest that fits, to confirm", and they are listed on its card.
 */
export type Caveat =
  /** The inverter passes on its running power alone: the quote states no start-up power. */
  | { id: 'surge_unstated' }
  /** The inverter covers the running load but not the 25% the kit sheet sizes its own inverter with. */
  | { id: 'no_headroom'; needW: number }
  /** A size the user confirmed, not the quote: the inverter, the battery, the panels, or what the quote left open. */
  | { id: 'confirmed'; item: ItemId }
  /** The bank passes even at the lowest depth of discharge, but a line of it names no chemistry. */
  | { id: 'chemistry_unstated' }
  | { id: 'chemistry_differs'; chemistry: ChemistryId }
  /** Battery units that can't make up the kit's voltage, or an inverter stated for another. */
  | { id: 'bank_voltage'; volts: number }
  | { id: 'inverter_voltage'; volts: number }
  /** The entry states no tax while another ranked beside it does, so the two totals may not be alike. */
  | { id: 'tax_unstated' }
  /** It ranks on the total the user typed, because its reading needs checking. */
  | { id: 'total_typed' }
export type CaveatId = Caveat['id']

/** What one ranked entry offers the caveats: its checks, the lines of its system, and the quote it comes from. */
export interface CaveatInput {
  items: readonly ItemCheck[]
  extraction: QuoteExtraction
  quote: { extraction: QuoteExtraction | null; totalOverride: number | null }
  optionId: string | null
}

/** A unit voltage within this share of a whole step of the kit's ("12.8 V" for 12 V, "51.2 V" for 48 V) makes it up. */
const VOLTAGE_TOLERANCE = 0.15
/**
 * The highest DC voltage an inverter line's `batteryVolts` is read as: the reading has no field for an inverter's AC
 * output, so a 120 V or 240 V there is the output, not the bank it takes.
 */
const MAX_DC_VOLTS = 60
/** A confirmation is about size, not presence, for these: what the quote says decides them. */
const SIZED_ITEMS: readonly ItemId[] = ['inverter', 'battery', 'panels']

const itemOf = (items: readonly ItemCheck[], id: ItemId): ItemCheck | undefined => items.find((c) => c.id === id)

/**
 * Whether marking an item as confirmed stands in for a size: always for the inverter, the battery and the panels, and
 * for any item the quote mentions without enough to judge it. Confirming that an item the quote leaves out is included
 * (a charger, the installation) is a fact the installer gave, not a size.
 */
export const confirmsSize = (c: ItemCheck): boolean => SIZED_ITEMS.includes(c.id) || c.source !== null

const isNear = (a: number, b: number): boolean => Math.abs(a - b) <= b * VOLTAGE_TOLERANCE

/** Whether `units` of `unitV` make up `kitV` in series: each one near a whole step of it, and at least that many. */
function makesUp(unitV: number, units: number, kitV: number): boolean {
  const inSeries = Math.max(1, Math.round(kitV / unitV))
  return isNear(unitV, kitV / inSeries) && units >= inSeries
}

function voltageCaveats(lines: readonly QuoteLine[], kit: KitNeeds): Caveat[] {
  const included = lines.filter((l) => !l.optional && l.specs.batteryVolts !== null)
  const batteries = included.filter((l) => l.kind === 'battery')
  // Units of one voltage make up a string together, whichever lines list them.
  const unitsAt = (volts: number): number => batteries.filter((l) => l.specs.batteryVolts === volts).reduce((a, l) => a + l.qty, 0)
  const bankVolts = [...new Set(batteries.map((l) => l.specs.batteryVolts!))].find((v) => !makesUp(v, unitsAt(v), kit.volts))
  const inverter = included.find((l) => l.kind === 'inverter' && l.specs.batteryVolts! <= MAX_DC_VOLTS && !isNear(l.specs.batteryVolts!, kit.volts))
  return [
    ...(bankVolts !== undefined ? [{ id: 'bank_voltage' as const, volts: bankVolts }] : []),
    ...(inverter ? [{ id: 'inverter_voltage' as const, volts: inverter.specs.batteryVolts! }] : []),
  ]
}

function inverterCaveats(items: readonly ItemCheck[], kit: KitNeeds): Caveat[] {
  const c = itemOf(items, 'inverter')
  if (c?.status !== 'ok' || c.facts.confirmed) return []
  const needW = Math.round(kit.runningW * SIZING.HEADROOM)
  return [
    ...(c.facts.surgeUnknown ? [{ id: 'surge_unstated' as const }] : []),
    ...(c.facts.watts !== undefined && c.facts.watts < needW ? [{ id: 'no_headroom' as const, needW }] : []),
  ]
}

/** The chemistry a line names, of those the catalog has: null for none, or "other". */
const namedChemistry = (l: QuoteLine): ChemistryId | null =>
  l.specs.chemistry === 'lifepo4' || l.specs.chemistry === 'agm' ? l.specs.chemistry : null

/** Every included battery line counts: one that names no chemistry, or another than the kit's, is part of the bank. */
function batteryCaveats(e: CaveatInput, kit: KitNeeds): Caveat[] {
  const c = itemOf(e.items, 'battery')
  if (c?.status !== 'ok' || c.facts.confirmed) return []
  const named = e.extraction.lines.filter((l) => l.kind === 'battery' && !l.optional).map(namedChemistry)
  const other = named.find((ch): ch is ChemistryId => ch !== null && ch !== kit.chemistry)
  return [
    ...(named.includes(null) ? [{ id: 'chemistry_unstated' as const }] : []),
    ...(other !== undefined ? [{ id: 'chemistry_differs' as const, chemistry: other }] : []),
  ]
}

/** The must-haves that pass on the user's confirmation of a size (confirmsSize), not on what the quote states. */
const confirmedCaveats = (items: readonly ItemCheck[], musts: Musts): Caveat[] =>
  items
    .filter((c) => musts[c.id] && c.status === 'ok' && c.facts.confirmed && confirmsSize(c))
    .map((c) => ({ id: 'confirmed', item: c.id }))

/**
 * Every caveat of one entry, in the order the card lists them. `taxElsewhere` says whether another entry ranked beside
 * it states tax.
 */
export function caveatsOf(e: CaveatInput, kit: KitNeeds, musts: Musts, taxElsewhere: boolean): Caveat[] {
  const whole = e.quote.extraction ?? e.extraction
  return [
    ...inverterCaveats(e.items, kit),
    ...batteryCaveats(e, kit),
    ...voltageCaveats(e.extraction.lines, kit),
    ...confirmedCaveats(e.items, musts),
    ...(taxElsewhere && !statesTax(whole, e.optionId) ? [{ id: 'tax_unstated' as const }] : []),
    ...(e.optionId === null && e.quote.totalOverride !== null ? [{ id: 'total_typed' as const }] : []),
  ]
}
