import { z } from 'zod'
import { SIZING } from './catalog'
import { RequesterSchema } from './requester'
import { SOLAR } from './solar'

export const HOURS_MIN = 1
export const HOURS_MAX = 72
/** The longest name a project stores. */
export const PROJECT_NAME_MAX = 60

/** The solar choice from step 3. `panels: null` means the recommended count; the whole object is null for a battery-only kit. */
export const SolarSchema = z.object({
  roofM2: z.number().min(SOLAR.ROOF_RANGE[0]).max(SOLAR.ROOF_RANGE[1]),
  panels: z.number().int().min(0).max(SOLAR.ROOF_RANGE[1] / SOLAR.M2_PER_PANEL).nullable(),
  sunHours: z.number().min(SOLAR.SUN_RANGE[0]).max(SOLAR.SUN_RANGE[1]),
})

/** Duty presets a user can pick for a cycling appliance, on top of the catalog value. */
export const DUTY_PRESETS = [0.25, 0.5, 0.75, 1] as const
export const RUN_LENGTH = { min: 0.5, max: 10, step: 0.5, default: 1.5 } as const
export const AMBIENTS = [30, 40, 50] as const
export const INSULATIONS = [75, 90] as const
export const STARTS = [1, 2, 'all'] as const

/**
 * How the install is wired: the motors assumed to start together, and where the battery cable runs. Every field has
 * a default and a catch, so `{}` and a half-saved object both read as the defaults.
 */
export const ElectricalSchema = z.object({
  simultaneousStarts: z.union([z.literal(1), z.literal(2), z.literal('all')]).default(1).catch(1),
  runLengthM: z.number().min(RUN_LENGTH.min).max(RUN_LENGTH.max).default(RUN_LENGTH.default).catch(RUN_LENGTH.default),
  ambientC: z.union([z.literal(30), z.literal(40), z.literal(50)]).default(30).catch(30),
  /** Battery cables share a conduit or are tied together, so the NEC bundling adjustment applies. */
  bundled: z.boolean().default(false).catch(false),
  insulationC: z.union([z.literal(75), z.literal(90)]).default(90).catch(90),
})
export type Electrical = z.infer<typeof ElectricalSchema>
export const DEFAULT_ELECTRICAL: Electrical = ElectricalSchema.parse({})

export const CustomLoadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  watts: z.number().positive(),
  surge: z.number().positive(),
  note: z.string(),
})

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(PROJECT_NAME_MAX),
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
  /** Share of each hour an appliance runs, by id, where the user changed it; absent means the catalog value. */
  dutyOverrides: z.record(z.string(), z.number().gt(0).lte(1)).default({}).catch({}),
  electrical: ElectricalSchema.default(DEFAULT_ELECTRICAL).catch(DEFAULT_ELECTRICAL),
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
