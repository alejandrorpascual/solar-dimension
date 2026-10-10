import { z } from 'zod'

/** Upper bounds that catch a slipped unit or digit; no real product comes near them. */
export const PRODUCT_LIMITS = {
  WATTS: 100_000, VOLTS: 1000, AMPS: 2000, PERCENT: 100, YEARS: 30, CYCLES: 100_000, SECONDS: 3600, UNITS: 100, KWH: 1000, AH: 5000,
} as const
const MAX_SURGE_LEVELS = 6
export const MAX_EXTRA_SPECS = 8
const MAX_BRANDS = 30
/** Longest text of each kind, in characters. */
const MAX_TEXT = 200
const MAX_BRAND_LENGTH = 60
const MAX_MODEL_LENGTH = 80
const MAX_SPEC_NAME_LENGTH = 60
const MAX_COMPATIBLE_BRAND_LENGTH = 60
const MAX_SELLER_LENGTH = 80

export const PRODUCT_KINDS = ['inverter', 'battery'] as const
export type ProductKind = (typeof PRODUCT_KINDS)[number]
export const PRODUCT_ORIGINS = ['admin', 'search'] as const
export type ProductOrigin = (typeof PRODUCT_ORIGINS)[number]
const BMS_PROTOCOLS = ['can', 'rs485'] as const
const BATTERY_CHEMISTRIES = ['lifepo4', 'agm', 'other'] as const

const httpsUrl = z.url({ protocol: /^https$/, message: 'an https URL' })
const text = (max = MAX_TEXT) => z.string().trim().min(1).max(max)

/**
 * One spec as the datasheet states it: the value, the page it is on and the datasheet's own words. A stated value needs
 * both, so every number can be checked against where it came from. A spec the datasheet does not give is all null.
 */
function spec<O>(value: z.ZodType<O>) {
  return z
    .object({ value: value.nullable(), source: httpsUrl.nullable(), asWritten: text().nullable() })
    .strict()
    .refine((s) => s.value === null || (s.source !== null && s.asWritten !== null), {
      message: 'a stated value needs its source and its words as written',
    })
}
const amount = (max: number) => spec(z.number().positive().max(max))
/** A count of things: 2.5 units is a slipped value. */
const count = (max: number) => spec(z.number().int().positive().max(max))

/** One surge or overload level and how long it holds; w is null for a level the maker gives only in VA. */
const SurgeLevelSchema = z
  .object({
    w: z.number().positive().max(PRODUCT_LIMITS.WATTS).nullable(),
    seconds: z.number().positive().max(PRODUCT_LIMITS.SECONDS).nullable(),
    asWritten: text(),
    source: httpsUrl,
  })
  .strict()
const ExtraSpecSchema = z.object({ name: text(MAX_SPEC_NAME_LENGTH), value: text(), source: httpsUrl }).strict()
const PriceSchema = z
  .object({ amount: z.number().positive(), currency: z.string().regex(/^[A-Z]{3}$/), seller: text(MAX_SELLER_LENGTH), url: httpsUrl, seenOn: z.iso.date() })
  .strict()
const comms = z.array(z.enum(BMS_PROTOCOLS)).max(BMS_PROTOCOLS.length)
const brands = z.array(text(MAX_COMPATIBLE_BRAND_LENGTH)).max(MAX_BRANDS)

export const InverterSpecsSchema = z
  .object({
    continuousW: amount(PRODUCT_LIMITS.WATTS),
    /** Every level the maker states, shortest first: "12,000W for ≈3.5 s | 11,000W for ≈5 s" is two. */
    surges: z.array(SurgeLevelSchema).max(MAX_SURGE_LEVELS),
    batteryVolts: amount(PRODUCT_LIMITS.VOLTS),
    splitPhase: spec(z.boolean()),
    chargerA: amount(PRODUCT_LIMITS.AMPS),
    pvInputW: amount(PRODUCT_LIMITS.WATTS),
    pvVocMax: amount(PRODUCT_LIMITS.VOLTS),
    maxParallelUnits: count(PRODUCT_LIMITS.UNITS),
    idleW: amount(PRODUCT_LIMITS.WATTS),
    peakEfficiencyPct: amount(PRODUCT_LIMITS.PERCENT),
    warrantyYears: amount(PRODUCT_LIMITS.YEARS),
    bmsComms: comms,
    /** Only brands the maker itself lists as compatible. */
    compatibleBatteryBrands: brands,
  })
  .strict()

export const BatterySpecsSchema = z
  .object({
    chemistry: spec(z.enum(BATTERY_CHEMISTRIES)),
    /** As the datasheet states it (51.2 V for a "48 V" LiFePO₄ unit), not the system class. */
    nominalV: amount(PRODUCT_LIMITS.VOLTS),
    ah: amount(PRODUCT_LIMITS.AH),
    kWh: amount(PRODUCT_LIMITS.KWH),
    maxContinuousA: amount(PRODUCT_LIMITS.AMPS),
    peakA: amount(PRODUCT_LIMITS.AMPS),
    peakSeconds: amount(PRODUCT_LIMITS.SECONDS),
    maxParallel: count(PRODUCT_LIMITS.UNITS),
    cycleLife: count(PRODUCT_LIMITS.CYCLES),
    warrantyYears: amount(PRODUCT_LIMITS.YEARS),
    bmsComms: comms,
    compatibleInverterBrands: brands,
  })
  .strict()

const common = {
  brand: text(MAX_BRAND_LENGTH),
  model: text(MAX_MODEL_LENGTH),
  makerUrl: httpsUrl.nullable(),
  /** Required: the library is a reference users can check, so every product links its datasheet. */
  datasheetUrl: httpsUrl,
  extraSpecs: z.array(ExtraSpecSchema).max(MAX_EXTRA_SPECS),
  price: PriceSchema.nullable(),
}

export const ProductInputSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('inverter'), ...common, specs: InverterSpecsSchema }).strict(),
    z.object({ kind: z.literal('battery'), ...common, specs: BatterySpecsSchema }).strict(),
  ])
  .refine((p) => normalize(p.brand) !== '', { path: ['brand'], message: 'the brand needs letters or digits' })
  .refine((p) => normalize(p.model) !== '', { path: ['model'], message: 'the model needs letters or digits' })

/** A value a later write read differently from the stored one, kept for the admin to settle. */
export const ProductConflictSchema = z.object({
  field: z.string(), found: z.unknown(), source: z.string().nullable(), seenAt: z.iso.datetime(),
})

export type ProductInput = z.infer<typeof ProductInputSchema>
export type InverterSpecs = z.infer<typeof InverterSpecsSchema>
export type BatterySpecs = z.infer<typeof BatterySpecsSchema>
export type SurgeLevel = z.infer<typeof SurgeLevelSchema>
export type ExtraSpec = z.infer<typeof ExtraSpecSchema>
export type ProductConflict = z.infer<typeof ProductConflictSchema>
export type ProductRecord = ProductInput & { id: string; key: string; origin: ProductOrigin; conflicts: ProductConflict[]; retired: boolean }

/** Lowercase letters and digits only, accents dropped. */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Words that trail a maker's legal or marketing name without telling makers apart ("Victron Energy" is Victron). */
const GENERIC_BRAND_WORDS = [
  'electronics', 'electric', 'technologies', 'technology', 'batteries', 'battery', 'solutions', 'solution', 'systems', 'storage', 'lithium', 'energy', 'solar', 'power',
] as const
/** Generic words stop coming off once fewer characters than this would be left ("LG Energy Solution" is LG, "Power" is Power). */
const MIN_BRAND_KEY = 2

/**
 * The maker as the key knows it: the whole name without spaces or punctuation, minus trailing generic words, so
 * "EG4" and "EG4 Electronics" are one maker, "Fox ESS" and "FoxESS" too, but "Power Queen" and "Power Sonic" are not.
 * When a real maker ends up split in two or merged with another, the word list above is the place to adjust.
 */
export function brandKey(brand: string): string {
  const withoutGeneric = (name: string): string => {
    const word = GENERIC_BRAND_WORDS.find((w) => name.endsWith(w) && name.length - w.length >= MIN_BRAND_KEY)
    return word ? withoutGeneric(name.slice(0, -word.length)) : name
  }
  return withoutGeneric(normalize(brand))
}

/** The model without the maker's name repeated at its start ("Pytes V5" is "V5"); the name is kept if nothing would be left. */
function modelKey(brand: string, model: string): string {
  const repeated = [normalize(brand), brandKey(brand)].find((name) => model.startsWith(name) && model.length > name.length)
  return repeated ? model.slice(repeated.length) : model
}

/**
 * The product's identity: kind, the maker (brandKey) and the model without a repeated maker name. It is stored as the
 * product's unique key, so changing the rule later means rewriting the stored keys. The skill also reuses a stored
 * product's spelling; this catches the rest.
 */
export function productKey(p: Pick<ProductInput, 'kind' | 'brand' | 'model'>): string {
  return `${p.kind}:${brandKey(p.brand)}:${modelKey(p.brand, normalize(p.model))}`
}

const MAX_BATCH = 50

export type ParsedProducts =
  | { ok: true; items: ProductInput[] }
  | { ok: false; errors: Array<{ index: number; issues: Array<{ path: string; message: string }> }> }

export function parseProducts(body: unknown): ParsedProducts {
  const list = Array.isArray(body) ? body : [body]
  if (list.length === 0 || list.length > MAX_BATCH) {
    return { ok: false, errors: [{ index: -1, issues: [{ path: '', message: `send 1 to ${MAX_BATCH} products` }] }] }
  }
  const results = list.map((item) => ProductInputSchema.safeParse(item))
  const errors = results.flatMap((r, index) =>
    r.success ? [] : [{ index, issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) }],
  )
  if (errors.length > 0) return { ok: false, errors }
  const items = results.map((r) => r.data!)
  const seen = new Set<string>()
  const duplicates = items.flatMap((item, index) => {
    const key = productKey(item)
    if (seen.has(key)) return [{ index, issues: [{ path: 'model', message: 'the same product twice in this request' }] }]
    seen.add(key)
    return []
  })
  return duplicates.length > 0 ? { ok: false, errors: duplicates } : { ok: true, items }
}
