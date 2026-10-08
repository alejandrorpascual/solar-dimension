import { z } from 'zod'
import { SIZING } from './catalog'
import { RequesterSchema } from './requester'
import { SOLAR } from './solar'

export const HOURS_MIN = 1
export const HOURS_MAX = 72

/** The solar choice from step 3. `panels: null` means the recommended count; the whole object is null for a battery-only kit. */
export const SolarSchema = z.object({
  roofM2: z.number().min(SOLAR.ROOF_RANGE[0]).max(SOLAR.ROOF_RANGE[1]),
  panels: z.number().int().min(0).max(SOLAR.ROOF_RANGE[1] / SOLAR.M2_PER_PANEL).nullable(),
  sunHours: z.number().min(SOLAR.SUN_RANGE[0]).max(SOLAR.SUN_RANGE[1]),
})

export const CustomLoadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  watts: z.number().positive(),
  surge: z.number().positive(),
  note: z.string(),
})

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  qty: z.record(z.string(), z.number().int().min(0).max(SIZING.MAX_QTY)),
  custom: z.array(CustomLoadSchema),
  hours: z.number().int().min(HOURS_MIN).max(HOURS_MAX),
  volts: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]),
  chemistry: z.enum(['lifepo4', 'agm']),
  /** Chosen battery unit ("12-200" = 12 V 200 Ah); null lets the engine pick the fewest batteries. */
  batteryUnit: z.string().min(1).max(20).nullable().default(null),
  /** Panels on the roof, or null for a battery-only kit. A copy that no longer parses becomes null, like `requester`. */
  solar: SolarSchema.nullable().default(null).catch(null),
  /** Milliseconds since epoch of the last edit on any device; the server only accepts writes that are not older than its copy. */
  updatedAt: z.number().int().nonnegative().default(0),
  /**
   * Who asked for the kit, printed on the spec sheet; null until added. A copy that no longer parses becomes null, so
   * one bad field never makes the whole saved store unreadable.
   */
  requester: RequesterSchema.nullable().default(null).catch(null),
})

export const StoreSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema).min(1),
  currentId: z.string().min(1),
})

export type Solar = z.infer<typeof SolarSchema>
export type CustomLoad = z.infer<typeof CustomLoadSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Store = z.infer<typeof StoreSchema>
