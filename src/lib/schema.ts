import { z } from 'zod'
import { SIZING } from './catalog'

export const HOURS_MIN = 1
export const HOURS_MAX = 72

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
  /** Milliseconds since epoch of the last edit on any device; the server only accepts writes that are not older than its copy. */
  updatedAt: z.number().int().nonnegative().default(0),
})

export const StoreSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema).min(1),
  currentId: z.string().min(1),
})

export type CustomLoad = z.infer<typeof CustomLoadSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Store = z.infer<typeof StoreSchema>
