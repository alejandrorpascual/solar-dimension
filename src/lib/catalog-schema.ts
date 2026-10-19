import { z } from 'zod'
import { LOAD_KINDS, MAX_APPLIANCE_SURGE, MAX_APPLIANCE_WATTS, SURGE_CLASSES, type ApplianceLabels, type CatalogItem, type CompressorType, type LoadKind, type SurgeClass } from './catalog'
import { isCustomLoadId } from './custom'

export const APPLIANCE_CATEGORIES = ['Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal'] as const
export type ApplianceCategory = (typeof APPLIANCE_CATEGORIES)[number]

const MAX_BATCH = 100
const LARGE_LOAD_W = 5000
const NONSTOP_HEAVY_W = 1000
const SECONDS_PER_HOUR = 3600
const MAX_BURST_SECONDS = 600
const MAX_CYCLES_PER_HOUR = 120
/** How far a momentary item's stored duty may sit from the duty its bursts imply before the admin is told. */
const MOMENTARY_DUTY_TOLERANCE = 0.25
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/

const Label = z.object({ name: z.string().trim().min(1).max(80), note: z.string().trim().max(160) }).strict()

export const ApplianceSchema = z
  .object({
    id: z
      .string()
      .regex(ID_PATTERN, 'lowercase letters, digits and dashes')
      .refine((id) => !isCustomLoadId(id), 'ids like "custom1" are reserved for custom loads'),
    category: z.enum(APPLIANCE_CATEGORIES),
    watts: z.number().int().min(1).max(MAX_APPLIANCE_WATTS),
    surge: z.number().int().min(1).max(MAX_APPLIANCE_SURGE),
    duty: z.number().gt(0).lte(1),
    tons: z.number().positive().nullable().default(null),
    acType: z.enum(['inverter', 'conventional']).nullable().default(null),
    /** Load kind and surge class; null lets the engine derive them from duty, surge and compressor type. */
    kind: z.enum(LOAD_KINDS as [LoadKind, ...LoadKind[]]).nullable().default(null),
    surgeClass: z.enum(SURGE_CLASSES as [SurgeClass, ...SurgeClass[]]).nullable().default(null),
    /** Momentary loads only: seconds per burst and bursts per hour. */
    burstSeconds: z.number().positive().max(MAX_BURST_SECONDS).nullable().default(null),
    cyclesPerHour: z.number().positive().max(MAX_CYCLES_PER_HOUR).nullable().default(null),
    labels: z.object({ en: Label, es: Label }).strict(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((a) => a.surge >= a.watts, { path: ['surge'], message: 'surge must be at least the running watts' })
  .refine((a) => a.surgeClass === null || a.surge > a.watts, { path: ['surgeClass'], message: 'a surge class needs a surge above the running watts' })
  .refine((a) => a.kind !== 'continuous' || a.duty === 1, { path: ['kind'], message: 'a continuous load has a duty of 1' })
  .refine((a) => (a.kind === 'momentary' ? a.burstSeconds !== null && a.cyclesPerHour !== null : a.burstSeconds === null && a.cyclesPerHour === null), {
    path: ['kind'], message: 'burstSeconds and cyclesPerHour are required for momentary loads, and only for them',
  })
  .refine((a) => a.burstSeconds === null || a.cyclesPerHour === null || a.burstSeconds * a.cyclesPerHour <= SECONDS_PER_HOUR, {
    path: ['cyclesPerHour'], message: 'the bursts cannot add up to more than an hour per hour',
  })
  .refine((a) => {
    if (a.category === 'Air conditioning') {
      return a.tons !== null && a.acType !== null
    }
    return a.tons === null && a.acType === null
  }, {
    path: ['category'],
    message: 'tons and acType are required for Air conditioning, and only for it',
  })

export type ApplianceInput = z.infer<typeof ApplianceSchema>
/** The fields added after the first seed; a stored record may lack them, which reads as null (derived by the engine). */
export type ApplianceExtraKey = 'kind' | 'surgeClass' | 'burstSeconds' | 'cyclesPerHour'
export const APPLIANCE_EXTRA_KEYS: readonly ApplianceExtraKey[] = ['kind', 'surgeClass', 'burstSeconds', 'cyclesPerHour']
export interface ApplianceRecord extends Omit<ApplianceInput, 'sortOrder' | ApplianceExtraKey>, Partial<Pick<ApplianceInput, ApplianceExtraKey>> {
  sortOrder: number
  retired: boolean
}

export function toCatalogItem(r: ApplianceRecord): CatalogItem {
  return {
    id: r.id, name: r.labels.en.name, note: r.labels.en.note, cat: r.category,
    watts: r.watts, surge: r.surge, duty: r.duty,
    ...(r.tons !== null ? { tons: r.tons } : {}),
    ...(r.acType !== null ? { acType: r.acType as CompressorType } : {}),
    ...(r.kind != null ? { kind: r.kind } : {}),
    ...(r.surgeClass != null ? { surgeClass: r.surgeClass } : {}),
    ...(r.burstSeconds != null ? { burstSeconds: r.burstSeconds } : {}),
    ...(r.cyclesPerHour != null ? { cyclesPerHour: r.cyclesPerHour } : {}),
    labels: r.labels as ApplianceLabels,
    retired: r.retired,
  }
}

/** The duty a momentary item's bursts imply, or null when it is not momentary. */
export function momentaryDuty(a: Pick<ApplianceInput, 'kind' | 'burstSeconds' | 'cyclesPerHour'>): number | null {
  if (a.kind !== 'momentary' || a.burstSeconds === null || a.cyclesPerHour === null) return null
  return (a.burstSeconds * a.cyclesPerHour) / SECONDS_PER_HOUR
}

/** Soft checks: worth a second look, never a reason to refuse. */
export function applianceWarnings(a: ApplianceInput): string[] {
  const out: string[] = []
  if (a.watts > LARGE_LOAD_W) out.push(`Over ${LARGE_LOAD_W / 1000} kW: check this is one appliance, not a whole circuit.`)
  if (a.duty === 1 && a.watts >= NONSTOP_HEAVY_W) out.push('Runs nonstop at 1 kW or more: most heating and motor loads cycle.')
  const implied = momentaryDuty(a)
  if (implied !== null && Math.abs(a.duty - implied) / implied > MOMENTARY_DUTY_TOLERANCE) {
    out.push(`The bursts imply a duty of ${implied.toFixed(3)}; the stored duty ${a.duty} is only shown, the engine uses the bursts.`)
  }
  return out
}

export type ParsedItems =
  | { ok: true; items: ApplianceInput[] }
  | { ok: false; errors: Array<{ index: number; issues: Array<{ path: string; message: string }> }> }

export function parseItems(body: unknown): ParsedItems {
  const list = Array.isArray(body) ? body : [body]
  if (list.length === 0 || list.length > MAX_BATCH) {
    return { ok: false, errors: [{ index: -1, issues: [{ path: '', message: `send 1 to ${MAX_BATCH} items` }] }] }
  }
  const results = list.map((item) => ApplianceSchema.safeParse(item))
  const errors = results.flatMap((r, index) =>
    r.success ? [] : [{ index, issues: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) }],
  )
  if (errors.length > 0) return { ok: false, errors }
  const items = results.map((r) => r.data!)
  const seenIds = new Set<string>()
  const duplicateErrors = items.flatMap((item, index) => {
    if (seenIds.has(item.id)) return [{ index, issues: [{ path: 'id', message: 'duplicate id in this request' }] }]
    seenIds.add(item.id)
    return []
  })
  if (duplicateErrors.length > 0) return { ok: false, errors: duplicateErrors }
  return { ok: true, items }
}

/** Pure check for the id the admin form is about to create; the server re-checks against the database before writing. */
export function idTakenMessage(id: string, existingIds: ReadonlySet<string>): string | null {
  return existingIds.has(id) ? `The id "${id}" is already used by another appliance. Change the English name.` : null
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
