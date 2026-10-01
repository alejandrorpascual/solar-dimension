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

const TEXT = { short: 120, code: 12, date: 10, description: 300, source: 160, note: 300 } as const
const LIST = { lines: 80, warranties: 10, notes: 20 } as const

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s)
const cutOrNull = (s: string | null, n: number): string | null => (s === null ? null : cut(s, n))

/** Trims every text to its limit, caps the lists and upper-cases the currency. Returns a new object. */
export function normalizeExtraction(x: QuoteExtraction): QuoteExtraction {
  return {
    ...x,
    vendor: { name: cutOrNull(x.vendor.name, TEXT.short), contact: cutOrNull(x.vendor.contact, TEXT.short) },
    date: cutOrNull(x.date, TEXT.date),
    validUntil: cutOrNull(x.validUntil, TEXT.date),
    currency: x.currency.trim().toUpperCase(),
    lines: x.lines.slice(0, LIST.lines).map((l) => ({
      ...l,
      description: cut(l.description, TEXT.description),
      brand: cutOrNull(l.brand, TEXT.short),
      model: cutOrNull(l.model, TEXT.short),
      specs: { ...l.specs, awg: cutOrNull(l.specs.awg, TEXT.code), fuseClass: cutOrNull(l.specs.fuseClass, TEXT.code) },
      source: { page: l.source.page, text: cut(l.source.text, TEXT.source) },
    })),
    warranties: x.warranties.slice(0, LIST.warranties),
    notes: x.notes.slice(0, LIST.notes).map((n) => cut(n, TEXT.note)),
  }
}
