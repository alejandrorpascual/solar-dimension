import { z } from 'zod'
import { LOAD_KINDS, MAX_APPLIANCE_SURGE, MAX_APPLIANCE_WATTS, SIZING, SURGE_CLASSES, type ApplianceLabels, type CatalogItem, type CompressorType, type LoadKind, type SurgeClass } from './catalog'
import { isCustomLoadId } from './custom'
import { httpsUrl } from './product-schema'

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
/** Motors start at 2–3× their running watts and compressors under 10×; more is likely a unit or digit slip. */
const MAX_SURGE_RATIO = 10
/** An air conditioner's running watts are expected within half to twice the engine's watts per ton. */
const AC_WATTS_LOW = 0.5
const AC_WATTS_HIGH = 2
/** An update that moves a figure more than this share of its stored value is flagged. */
const MAX_CHANGE_SHARE = 0.5
type ChangeCheckedField = 'watts' | 'surge' | 'duty'
const CHANGE_CHECKED: ReadonlyArray<{ field: ChangeCheckedField; label: string }> = [
  { field: 'watts', label: 'Running watts' },
  { field: 'surge', label: 'Surge' },
  { field: 'duty', label: 'Duty' },
]
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/

const Label = z.object({ name: z.string().trim().min(1).max(80), note: z.string().trim().max(160) }).strict()

/** Room for the two sources that must agree when a figure has no datasheet or nameplate, and one more. */
const MAX_SOURCES_PER_FIGURE = 3
const MAX_AS_WRITTEN = 200
/** Where a figure came from: the page, and its words as written there, so the figure can be checked against them. */
const FigureSourceSchema = z.object({ source: httpsUrl, asWritten: z.string().trim().min(1).max(MAX_AS_WRITTEN) }).strict()
const FigureSourceListSchema = z.array(FigureSourceSchema).min(1).max(MAX_SOURCES_PER_FIGURE)
export const FigureSourcesSchema = z
  .object({
    watts: FigureSourceListSchema.optional(),
    surge: FigureSourceListSchema.optional(),
    duty: FigureSourceListSchema.optional(),
    burstSeconds: FigureSourceListSchema.optional(),
    cyclesPerHour: FigureSourceListSchema.optional(),
  })
  .strict()
export type FigureSource = z.infer<typeof FigureSourceSchema>
export type FigureSources = z.infer<typeof FigureSourcesSchema>

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
    /** Left out, a write keeps the stored sources; given, it replaces all of them (`{}` clears them). */
    sources: FigureSourcesSchema.optional(),
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

/** A warning when an air conditioner draws outside half to twice the watts its tons imply; null otherwise. */
function acWattsWarning(a: ApplianceInput): string | null {
  if (a.tons === null) return null
  const perTon = a.tons * SIZING.WATTS_PER_TON
  const [low, high] = [perTon * AC_WATTS_LOW, perTon * AC_WATTS_HIGH]
  if (a.watts >= low && a.watts <= high) return null
  return `${a.watts} W is outside ${Math.round(low)}–${Math.round(high)} W for ${a.tons} ${a.tons === 1 ? 'ton' : 'tons'}: check the tons and the running watts.`
}

/** A stored figure moved far enough that a slipped digit or unit is more likely than a correction. */
function changeWarnings(a: ApplianceInput, stored: Pick<ApplianceRecord, ChangeCheckedField>): string[] {
  return CHANGE_CHECKED.flatMap(({ field, label }) => {
    const [from, to] = [stored[field], a[field]]
    const share = Math.abs(to - from) / from
    return share > MAX_CHANGE_SHARE ? [`${label} from the stored ${from} to ${to} is a change of ${Math.round(share * 100)}%: check the digits and the unit.`] : []
  })
}

/** Soft checks: worth a second look, never a reason to refuse. With the stored row, also a big move away from it. */
export function applianceWarnings(a: ApplianceInput, stored?: Pick<ApplianceRecord, ChangeCheckedField>): string[] {
  const out: string[] = []
  if (a.watts > LARGE_LOAD_W) out.push(`Over ${LARGE_LOAD_W / 1000} kW: check this is one appliance, not a whole circuit.`)
  if (a.duty === 1 && a.watts >= NONSTOP_HEAVY_W) out.push('Runs nonstop at 1 kW or more: most heating and motor loads cycle.')
  if (a.surge > a.watts * MAX_SURGE_RATIO) {
    out.push(`Surge is ${Number((a.surge / a.watts).toFixed(1))}× the running watts: motors start at 2–3× and compressors under ${MAX_SURGE_RATIO}×. Check the surge is in watts.`)
  }
  const acWatts = acWattsWarning(a)
  if (acWatts !== null) out.push(acWatts)
  const implied = momentaryDuty(a)
  if (implied !== null && Math.abs(a.duty - implied) / implied > MOMENTARY_DUTY_TOLERANCE) {
    out.push(`The bursts imply a duty of ${implied.toFixed(3)}; the stored duty ${a.duty} is only shown, the engine uses the bursts.`)
  }
  return stored ? [...out, ...changeWarnings(a, stored)] : out
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
