import { z } from 'zod'
import type { ApplianceLabels, CatalogItem, CompressorType } from './catalog'

export const APPLIANCE_CATEGORIES = ['Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal'] as const
export type ApplianceCategory = (typeof APPLIANCE_CATEGORIES)[number]

export const MAX_APPLIANCE_WATTS = 30_000
const MAX_BATCH = 100
const LARGE_LOAD_W = 5000
const NONSTOP_HEAVY_W = 1000
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/
const CUSTOM_LOAD_ID_PATTERN = /^custom\d+$/

const Label = z.object({ name: z.string().trim().min(1).max(80), note: z.string().trim().max(160) }).strict()

export const ApplianceSchema = z
  .object({
    id: z
      .string()
      .regex(ID_PATTERN, 'lowercase letters, digits and dashes')
      .refine((id) => !CUSTOM_LOAD_ID_PATTERN.test(id), 'ids like "custom1" are reserved for custom loads'),
    category: z.enum(APPLIANCE_CATEGORIES),
    watts: z.number().int().min(1).max(MAX_APPLIANCE_WATTS),
    surge: z.number().int().min(1).max(MAX_APPLIANCE_WATTS * 4),
    duty: z.number().gt(0).lte(1),
    tons: z.number().positive().nullable().default(null),
    acType: z.enum(['inverter', 'conventional']).nullable().default(null),
    labels: z.object({ en: Label, es: Label }).strict(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((a) => a.surge >= a.watts, { path: ['surge'], message: 'surge must be at least the running watts' })
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
export interface ApplianceRecord extends Omit<ApplianceInput, 'sortOrder'> { sortOrder: number; retired: boolean }

export function toCatalogItem(r: ApplianceRecord): CatalogItem {
  return {
    id: r.id, name: r.labels.en.name, note: r.labels.en.note, cat: r.category,
    watts: r.watts, surge: r.surge, duty: r.duty,
    ...(r.tons !== null ? { tons: r.tons } : {}),
    ...(r.acType !== null ? { acType: r.acType as CompressorType } : {}),
    labels: r.labels as ApplianceLabels,
    retired: r.retired,
  }
}

/** Soft checks: worth a second look, never a reason to refuse. */
export function applianceWarnings(a: ApplianceInput): string[] {
  const out: string[] = []
  if (a.watts > LARGE_LOAD_W) out.push(`Over ${LARGE_LOAD_W / 1000} kW: check this is one appliance, not a whole circuit.`)
  if (a.duty === 1 && a.watts >= NONSTOP_HEAVY_W) out.push('Runs nonstop at 1 kW or more: most heating and motor loads cycle.')
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
  return { ok: true, items: results.map((r) => r.data!) }
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
