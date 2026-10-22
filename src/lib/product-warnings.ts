import { VOLTAGES } from './catalog'
import { brandKey, modelKey, productKey, type BatterySpecs, type InverterSpecs, type ProductInput } from './product-schema'

/** One product's soft checks, by its key. */
export interface ProductWarnings { key: string; messages: string[] }

/** A battery's kWh and its volts × Ah may differ by this share before it is flagged. */
const KWH_TOLERANCE = 0.1
const WH_PER_KWH = 1000
/** A nominal voltage within this share of a system class is that class: 51.2 V is 48 V, as in quote-caveats.ts. */
const VOLTAGE_TOLERANCE = 0.15
const MIN_EFFICIENCY_PCT = 50
const MIN_CONTINUOUS_W = 100
/** Two models of one maker whose keys start with this many same characters may be one product spelled two ways. */
const MODEL_PREFIX = 6

const percent = (share: number) => Math.round(share * 100)

function voltsWarnings(volts: number | null, what: string): string[] {
  if (volts === null || VOLTAGES.some((v) => Math.abs(volts - v) <= v * VOLTAGE_TOLERANCE)) return []
  return [`${volts} V is more than ${percent(VOLTAGE_TOLERANCE)}% from ${VOLTAGES.slice(0, -1).join(', ')} or ${VOLTAGES.at(-1)} V: check the ${what}.`]
}

function inverterWarnings(s: InverterSpecs): string[] {
  const [continuous, efficiency] = [s.continuousW.value, s.peakEfficiencyPct.value]
  const below = continuous === null ? [] : s.surges.filter((l) => l.w !== null && l.w < continuous)
  return [
    ...(continuous !== null && continuous < MIN_CONTINUOUS_W
      ? [`${continuous} W continuous is under ${MIN_CONTINUOUS_W} W: check the power is in watts.`]
      : []),
    ...below.map((l) => `A surge of ${l.w} W is below the ${continuous} W continuous: check the surge levels.`),
    ...voltsWarnings(s.batteryVolts.value, 'battery voltage'),
    ...(efficiency !== null && efficiency < MIN_EFFICIENCY_PCT ? [`Peak efficiency ${efficiency}% is under ${MIN_EFFICIENCY_PCT}%: check it is a percent.`] : []),
  ]
}

function energyWarnings(s: BatterySpecs): string[] {
  const [volts, ah, kWh] = [s.nominalV.value, s.ah.value, s.kWh.value]
  if (volts === null || ah === null || kWh === null) return []
  const expected = (volts * ah) / WH_PER_KWH
  const off = Math.abs(kWh - expected) / expected
  if (off <= KWH_TOLERANCE) return []
  return [`${kWh} kWh is ${percent(off)}% off ${volts} V × ${ah} Ah = ${Number(expected.toFixed(2))} kWh: check the energy, the voltage and the amp-hours.`]
}

function batteryWarnings(s: BatterySpecs): string[] {
  const [peak, continuous] = [s.peakA.value, s.maxContinuousA.value]
  return [
    ...energyWarnings(s),
    ...(peak !== null && continuous !== null && peak < continuous
      ? [`Peak ${peak} A is below the ${continuous} A continuous: check the peak and continuous current.`]
      : []),
    ...voltsWarnings(s.nominalV.value, 'nominal voltage'),
  ]
}

interface Spec { value: unknown; source: string | null; asWritten: string | null }
const isSpec = (entry: [string, unknown]): entry is [string, Spec] =>
  typeof entry[1] === 'object' && entry[1] !== null && !Array.isArray(entry[1]) && 'asWritten' in entry[1]
/** The specs that hold one stated value, by field path: everything but the surge levels and the lists. */
const specFields = (p: ProductInput): Array<[string, Spec]> =>
  Object.entries(p.specs).filter(isSpec).map(([name, s]): [string, Spec] => [`specs.${name}`, s])
const surgesOf = (p: ProductInput) => (p.kind === 'inverter' ? p.specs.surges : [])

/** Every stated number with its words as written: spec values, and each surge level's watts and seconds. */
function statedNumbers(p: ProductInput): Array<{ field: string; value: number; asWritten: string }> {
  const plain = specFields(p).flatMap(([field, s]) =>
    (typeof s.value === 'number' && s.asWritten !== null ? [{ field, value: s.value, asWritten: s.asWritten }] : []))
  const levels = surgesOf(p).flatMap((l, i) => (['w', 'seconds'] as const).flatMap((k) => {
    const value = l[k]
    return value === null ? [] : [{ field: `specs.surges.${i}.${k}`, value, asWritten: l.asWritten }]
  }))
  return [...plain, ...levels]
}

/** Digits only, so "12,000 W" holds 12000 and "5,12 kWh" holds 5.12. */
const digitsOf = (s: string) => s.replace(/\D/g, '')
/** A value's digits without leading zeros, so 0.95 is found in ".95". */
const valueDigits = (v: number) => digitsOf(String(v)).replace(/^0+/, '')

function digitWarnings(p: ProductInput): string[] {
  return statedNumbers(p)
    .filter((n) => !digitsOf(n.asWritten).includes(valueDigits(n.value)))
    .map((n) => `${n.field} ${n.value} is not in its words as written ("${n.asWritten}"): check the digits.`)
}

const hostOf = (url: string) => new URL(url).hostname

/** One warning per host that is neither the maker page's nor the datasheet's, naming the fields sourced there. */
function sourceHostWarnings(p: ProductInput): string[] {
  const own = new Set([p.datasheetUrl, p.makerUrl].flatMap((u) => (u === null ? [] : [hostOf(u)])))
  const sourced = [
    ...specFields(p).flatMap(([field, s]) => (s.source === null ? [] : [{ field, host: hostOf(s.source) }])),
    ...surgesOf(p).map((l, i) => ({ field: `specs.surges.${i}`, host: hostOf(l.source) })),
    ...p.extraSpecs.map((l) => ({ field: `extraSpecs.${l.name}`, host: hostOf(l.source) })),
  ].filter((s) => !own.has(s.host))
  return [...new Set(sourced.map((s) => s.host))].map((host) => {
    const fields = sourced.filter((s) => s.host === host).map((s) => s.field)
    return `Source host ${host} (${fields.join(', ')}) is neither the maker page's nor the datasheet's: check the maker states the same.`
  })
}

/** The checks on one product alone. */
const specWarnings = (p: ProductInput): string[] => [
  ...(p.kind === 'inverter' ? inverterWarnings(p.specs) : batteryWarnings(p.specs)),
  ...digitWarnings(p),
  ...sourceHostWarnings(p),
]

interface Candidate { product: ProductInput; key: string; isStored: boolean }

/** Same maker, and the same datasheet, the same maker page or a model key starting with the same characters. */
function isPossibleDuplicate(a: ProductInput, b: ProductInput): boolean {
  if (brandKey(a.brand) !== brandKey(b.brand)) return false
  const sharesModelStart = modelKey(a).slice(0, MODEL_PREFIX) === modelKey(b).slice(0, MODEL_PREFIX)
  return a.datasheetUrl === b.datasheetUrl || (a.makerUrl !== null && a.makerUrl === b.makerUrl) || sharesModelStart
}

const duplicateMessage = ({ product, key, isStored }: Candidate) =>
  isStored
    ? `Possible duplicate of the stored ${product.brand} ${product.model} (${key}).`
    : `Possible duplicate of ${product.brand} ${product.model} (${key}) in this request.`

/**
 * The soft checks for each incoming product: odd specs, and possible duplicates among the stored products and the rest
 * of the request. Worth a second look, never a reason to refuse. Only products with something to say are listed.
 */
export function warnProducts(stored: readonly ProductInput[], incoming: readonly ProductInput[]): ProductWarnings[] {
  const keys = new Set(incoming.map(productKey))
  // A stored product that is also in the request is named once, as in this request.
  const candidates: Candidate[] = [
    ...stored.map((product) => ({ product, key: productKey(product), isStored: true })).filter((c) => !keys.has(c.key)),
    ...incoming.map((product) => ({ product, key: productKey(product), isStored: false })),
  ]
  return incoming
    .map((item) => {
      const key = productKey(item)
      const duplicates = candidates.filter((c) => c.key !== key && isPossibleDuplicate(item, c.product)).map(duplicateMessage)
      return { key, messages: [...specWarnings(item), ...duplicates] }
    })
    .filter((w) => w.messages.length > 0)
}
