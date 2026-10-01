import { z } from 'zod'

export const LINE_KINDS = [
  'inverter', 'battery', 'panel', 'charge_controller', 'charger', 'monitoring', 'fuse', 'mounting', 'wiring', 'labor', 'other',
] as const
export type LineKind = (typeof LINE_KINDS)[number]
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
  /** Alternative systems the document offers, each priced on its own. Empty for a quote that offers one system. */
  options: z.array(z.object({ id: z.string(), label: z.string(), total: z.number().nullable() })),
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
  warranties: z.array(z.object({ kind: z.enum(WARRANTY_KINDS), years: z.number() })),
  notes: z.array(z.string()),
})
export type QuoteExtraction = z.infer<typeof QuoteExtractionSchema>
export type QuoteLine = QuoteExtraction['lines'][number]
export type LineSpecs = QuoteLine['specs']

export type QuoteOption = QuoteExtraction['options'][number]

/** A reading as stored: one saved before options has neither field (jsonb is read as is). */
export type StoredExtraction = Omit<QuoteExtraction, 'options' | 'lines'> & {
  options?: QuoteOption[]
  lines: (Omit<QuoteLine, 'option'> & { option?: string | null })[]
}

/** A stored reading with the option fields filled: a reading from before options offers one system. Returns a new object. */
export function withOptionDefaults(x: StoredExtraction): QuoteExtraction {
  return { ...x, options: x.options ?? [], lines: x.lines.map((l) => ({ ...l, option: l.option ?? null })) }
}

const TEXT = { short: 120, code: 12, date: 10, description: 300, source: 160, note: 300, optionLabel: 60 } as const
const LIST = { lines: 80, warranties: 10, notes: 20 } as const
/** The most options one quote keeps; a sixth system and its lines are dropped. */
export const MAX_OPTIONS = 5

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s)
const cutOrNull = (s: string | null, n: number): string | null => (s === null ? null : cut(s, n))

/**
 * The options kept and the ids dropped by the cap. Ids are cut like codes and a repeated id keeps the first. Fewer than
 * two options is one system, so none are kept and none dropped: every line becomes shared.
 */
function splitOptions(options: readonly QuoteOption[]): { kept: QuoteOption[]; dropped: Set<string> } {
  const cutOptions = options.map((o) => ({ ...o, id: cut(o.id, TEXT.code), label: cut(o.label.trim(), TEXT.optionLabel) }))
  const unique = cutOptions.filter((o, i) => cutOptions.findIndex((p) => p.id === o.id) === i)
  const kept = unique.slice(0, MAX_OPTIONS)
  if (kept.length < 2) return { kept: [], dropped: new Set() }
  return { kept, dropped: new Set(unique.slice(MAX_OPTIONS).map((o) => o.id)) }
}

/** A line's option after the split: kept, null (shared, or an id never listed), or undefined when its option was dropped. */
function lineOption(option: string | null, kept: ReadonlySet<string>, dropped: ReadonlySet<string>): string | null | undefined {
  if (option === null) return null
  const id = cut(option, TEXT.code)
  if (kept.has(id)) return id
  return dropped.has(id) ? undefined : null
}

/** Trims every text to its limit, caps the lists, splits the options and upper-cases the currency. Returns a new object. */
export function normalizeExtraction(x: QuoteExtraction): QuoteExtraction {
  const { kept, dropped } = splitOptions(x.options)
  const keptIds = new Set(kept.map((o) => o.id))
  return {
    ...x,
    vendor: { name: cutOrNull(x.vendor.name, TEXT.short), contact: cutOrNull(x.vendor.contact, TEXT.short) },
    date: cutOrNull(x.date, TEXT.date),
    validUntil: cutOrNull(x.validUntil, TEXT.date),
    currency: x.currency.trim().toUpperCase(),
    options: kept,
    lines: x.lines.slice(0, LIST.lines).flatMap((l) => {
      const option = lineOption(l.option, keptIds, dropped)
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
    warranties: x.warranties.slice(0, LIST.warranties),
    notes: x.notes.slice(0, LIST.notes).map((n) => cut(n, TEXT.note)),
  }
}
