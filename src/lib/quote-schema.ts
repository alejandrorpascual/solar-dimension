import { z } from 'zod'

export const LINE_KINDS = [
  'inverter', 'battery', 'panel', 'charge_controller', 'charger', 'monitoring', 'fuse', 'mounting', 'wiring', 'labor', 'other',
] as const
export type LineKind = (typeof LINE_KINDS)[number]
/** What a wiring line connects, as the document says: the battery bank, the solar array, the AC side, ground, or a fitting (lugs, conduit) that is no cable. */
export const LINE_ROLES = ['battery', 'solar', 'ac', 'ground', 'fitting', 'other'] as const
export type LineRole = (typeof LINE_ROLES)[number]
export const WARRANTY_KINDS = ['inverter', 'battery', 'panel', 'labor', 'other'] as const

export const QUOTE_STATUSES = ['queued', 'processing', 'ready', 'needs_review', 'failed'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
/** Statuses where the reading is over, whatever the outcome. */
export const FINISHED: readonly QuoteStatus[] = ['ready', 'needs_review', 'failed']
/** Still waiting for the model, or being read by it. */
export const isPending = (s: QuoteStatus): boolean => s === 'queued' || s === 'processing'

/** Tokens spent by one model call, stored per attempt so the real cost can be read from the database. */
export interface QuoteUsage { model: string; input: number; output: number }

/**
 * What the model returns and what is stored. There are no length or range rules here: OpenAI's strict structured
 * output rejects some JSON Schema keywords, so limits are applied afterwards by normalizeExtraction and checkExtraction.
 * Specs are per unit; `qty` says how many units a line covers.
 */
export const QuoteExtractionSchema = z.object({
  vendor: z.object({ name: z.string().nullable(), contact: z.string().nullable() }),
  date: z.string().nullable(),
  validUntil: z.string().nullable(),
  currency: z.string(),
  /**
   * Alternative systems the document offers, each priced on its own. Empty for a quote that offers one system. `total`
   * and `tax` are only what the document writes for that option.
   */
  options: z.array(z.object({ id: z.string(), label: z.string(), total: z.number().nullable(), tax: z.number().nullable() })),
  lines: z.array(
    z.object({
      kind: z.enum(LINE_KINDS),
      description: z.string(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      qty: z.number(),
      unitPrice: z.number().nullable(),
      lineTotal: z.number(),
      optional: z.boolean(),
      /** The id of the option the line belongs to; null when it applies to every option, or the quote offers one system. */
      option: z.string().nullable(),
      /** What a wiring line connects; null for other kinds, or when the document doesn't say. */
      role: z.enum(LINE_ROLES).nullable(),
      specs: z.object({
        watts: z.number().nullable(),
        surgeWatts: z.number().nullable(),
        hasCharger: z.boolean().nullable(),
        hasWifi: z.boolean().nullable(),
        batteryVolts: z.number().nullable(),
        ah: z.number().nullable(),
        kWh: z.number().nullable(),
        chemistry: z.enum(['lifepo4', 'agm', 'other']).nullable(),
        panelWatts: z.number().nullable(),
        chargerAmps: z.number().nullable(),
        awg: z.string().nullable(),
        mm2: z.number().nullable(),
        fuseAmps: z.number().nullable(),
        fuseClass: z.string().nullable(),
      }),
      source: z.object({ page: z.number().nullable(), text: z.string() }),
    }),
  ),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  total: z.number(),
  warranties: z.array(
    z.object({
      kind: z.enum(WARRANTY_KINDS),
      years: z.number(),
      /** The id of the option the warranty covers; null when it covers every option, or the quote offers one system. */
      option: z.string().nullable(),
    }),
  ),
  notes: z.array(z.string()),
})
export type QuoteExtraction = z.infer<typeof QuoteExtractionSchema>
export type QuoteLine = QuoteExtraction['lines'][number]
export type LineSpecs = QuoteLine['specs']

export type QuoteOption = QuoteExtraction['options'][number]
export type QuoteWarranty = QuoteExtraction['warranties'][number]

/** A reading as stored: one saved before options has none of the option fields, one saved before roles no role (jsonb is read as is). */
export type StoredExtraction = Omit<QuoteExtraction, 'options' | 'lines' | 'warranties'> & {
  options?: (Omit<QuoteOption, 'tax'> & { tax?: number | null })[]
  lines: (Omit<QuoteLine, 'option' | 'role'> & { option?: string | null; role?: LineRole | null })[]
  warranties: (Omit<QuoteWarranty, 'option'> & { option?: string | null })[]
}

/**
 * A stored reading with the option and role fields filled: a reading from before options offers one system, and a line
 * from before roles has none. Returns a new object.
 */
export function withOptionDefaults(x: StoredExtraction): QuoteExtraction {
  return {
    ...x,
    options: (x.options ?? []).map((o) => ({ ...o, tax: o.tax ?? null })),
    lines: x.lines.map((l) => ({ ...l, option: l.option ?? null, role: l.role ?? null })),
    warranties: x.warranties.map((w) => ({ ...w, option: w.option ?? null })),
  }
}

/** The longest a code-like spec (a gauge, a fuse class) is kept: a longer one is cut, maybe mid-word. */
export const CODE_LENGTH = 12
const TEXT = { short: 120, code: CODE_LENGTH, date: 10, description: 300, source: 160, note: 300, optionLabel: 60 } as const
const LIST = { lines: 80, warranties: 10, notes: 20 } as const
/** The most options one quote keeps; a sixth system and its lines are dropped. */
export const MAX_OPTIONS = 5

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s)
const cutOrNull = (s: string | null, n: number): string | null => (s === null ? null : cut(s, n))

interface OptionSplit {
  /** The options kept, renamed to o1, o2, … in order. */
  kept: QuoteOption[]
  /** Each kept option's id as the model wrote it (trimmed) → its canonical id. */
  ids: ReadonlyMap<string, string>
  /** The ids, as written, of the options past the cap. */
  dropped: ReadonlySet<string>
}

/**
 * The options kept, and the ids dropped by the cap. A repeated id keeps the first, matched on the whole trimmed id: a
 * shortened id would fold "alternativa-1" and "alternativa-2" into one. Kept options get the ids o1, o2, … so every id
 * is short and unique whatever the model wrote. Fewer than two options is one system, so none are kept and none
 * dropped: every line becomes shared.
 */
function splitOptions(options: readonly QuoteOption[]): OptionSplit {
  const trimmed = options.map((o) => ({ ...o, id: o.id.trim(), label: cut(o.label.trim(), TEXT.optionLabel) }))
  const unique = trimmed.filter((o, i) => trimmed.findIndex((p) => p.id === o.id) === i)
  const kept = unique.slice(0, MAX_OPTIONS)
  if (kept.length < 2) return { kept: [], ids: new Map(), dropped: new Set() }
  const canonical = kept.map((o, i) => ({ ...o, id: `o${i + 1}` }))
  return {
    kept: canonical,
    ids: new Map(kept.map((o, i) => [o.id, `o${i + 1}`])),
    dropped: new Set(unique.slice(MAX_OPTIONS).map((o) => o.id)),
  }
}

/**
 * The option of a line that names an id the model never listed. It is in no option, so a mistyped id can't make the
 * line shared equipment that every option pays for; checkExtraction sends such a reading to review.
 */
export const UNLISTED_OPTION = '?'

/**
 * A line's (or warranty's) option after the split: its canonical id, null (shared, or the quote offers one system), UNLISTED_OPTION for
 * an id never listed, or undefined when its option was dropped.
 */
function lineOption(option: string | null, split: OptionSplit): string | null | undefined {
  if (option === null || split.kept.length < 2) return null
  const id = option.trim()
  const canonical = split.ids.get(id)
  if (canonical !== undefined) return canonical
  return split.dropped.has(id) ? undefined : UNLISTED_OPTION
}

/** Trims every text to its limit, caps the lists, splits the options (of lines and warranties alike) and upper-cases the currency. Returns a new object. */
export function normalizeExtraction(x: QuoteExtraction): QuoteExtraction {
  const split = splitOptions(x.options)
  return {
    ...x,
    vendor: { name: cutOrNull(x.vendor.name, TEXT.short), contact: cutOrNull(x.vendor.contact, TEXT.short) },
    date: cutOrNull(x.date, TEXT.date),
    validUntil: cutOrNull(x.validUntil, TEXT.date),
    currency: x.currency.trim().toUpperCase(),
    options: split.kept,
    lines: x.lines.slice(0, LIST.lines).flatMap((l) => {
      const option = lineOption(l.option, split)
      if (option === undefined) return []
      return [{
        ...l,
        option,
        description: cut(l.description, TEXT.description),
        brand: cutOrNull(l.brand, TEXT.short),
        model: cutOrNull(l.model, TEXT.short),
        specs: { ...l.specs, awg: cutOrNull(l.specs.awg, TEXT.code), fuseClass: cutOrNull(l.specs.fuseClass, TEXT.code) },
        source: { page: l.source.page, text: cut(l.source.text, TEXT.source) },
      }]
    }),
    warranties: x.warranties.slice(0, LIST.warranties).flatMap((w) => {
      const option = lineOption(w.option, split)
      return option === undefined ? [] : [{ ...w, option }]
    }),
    notes: x.notes.slice(0, LIST.notes).map((n) => cut(n, TEXT.note)),
  }
}
