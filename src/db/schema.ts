import { sql } from 'drizzle-orm'
import { check, date, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ApplianceLabels } from '../lib/catalog'
import { APPLIANCE_CATEGORIES, type ApplianceRecord } from '../lib/catalog-schema'
import { LOAD_KINDS, SURGE_CLASSES } from '../lib/catalog'
import type { Musts, Overrides } from '../lib/quote-items'
import type { Requester } from '../lib/requester'
import type { CustomLoad, Electrical, Solar } from '../lib/schema'
import { QUOTE_STATUSES, type StoredExtraction, type QuoteStatus, type QuoteUsage } from '../lib/quote-schema'
import { PRODUCT_KINDS, PRODUCT_ORIGINS, type BatterySpecs, type ExtraSpec, type InverterSpecs, type ProductConflict, type ProductInput } from '../lib/product-schema'

import { user } from './auth-schema'

export * from './auth-schema'

export const projects = pgTable(
  'projects',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    qty: jsonb('qty').$type<Record<string, number>>().notNull(),
    custom: jsonb('custom').$type<CustomLoad[]>().notNull(),
    hours: integer('hours').notNull(),
    volts: integer('volts').notNull(),
    chemistry: text('chemistry').notNull(),
    batteryUnit: text('battery_unit'),
    /** Who asked for the kit (printed on the spec sheet); null until added. Validated by RequesterSchema on read. */
    requester: jsonb('requester').$type<Requester>(),
    /** Duty the user set per appliance id; `{}` when every appliance runs its catalog duty. */
    dutyOverrides: jsonb('duty_overrides').$type<Record<string, number>>().notNull().default({}),
    /** Starts and cable conditions; `{}` means every default. Validated by ElectricalSchema on read. */
    electrical: jsonb('electrical').$type<Partial<Electrical>>().notNull().default({}),
    /** Panels on the roof (step 3); null for a battery-only kit. Validated by SolarSchema on read. */
    solar: jsonb('solar').$type<Solar>(),
    /**
     * By field, the stamp (ms) of the edit that last wrote it, set when a save names fields; a field missing here was
     * last written at `updatedAt`, by a save of the whole project. A named field is written only by an edit not older.
     */
    fieldStamps: jsonb('field_stamps').$type<Record<string, number>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

const categoryList = sql.raw(APPLIANCE_CATEGORIES.map((c) => `'${c}'`).join(', '))
const kindList = sql.raw(LOAD_KINDS.map((k) => `'${k}'`).join(', '))
const surgeClassList = sql.raw(SURGE_CLASSES.map((k) => `'${k}'`).join(', '))

export const appliances = pgTable(
  'appliances',
  {
    id: text('id').primaryKey(),
    category: text('category').notNull(),
    watts: integer('watts').notNull(),
    surge: integer('surge').notNull(),
    // double precision, not real: real would turn 0.35 into 0.3499999940… and change the kit numbers.
    duty: doublePrecision('duty').notNull(),
    tons: doublePrecision('tons'),
    acType: text('ac_type'),
    /** Load kind and surge class; null means the engine derives them from duty, surge and compressor type. */
    kind: text('kind'),
    surgeClass: text('surge_class'),
    /** Momentary loads only: seconds per burst and bursts per hour. */
    burstSeconds: doublePrecision('burst_seconds'),
    cyclesPerHour: doublePrecision('cycles_per_hour'),
    labels: jsonb('labels').$type<ApplianceLabels>().notNull(),
    sortOrder: integer('sort_order').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    check('appliances_category_check', sql`${t.category} in (${categoryList})`),
    check('appliances_surge_check', sql`${t.surge} >= ${t.watts}`),
    check('appliances_duty_check', sql`${t.duty} > 0 and ${t.duty} <= 1`),
    check('appliances_kind_check', sql`${t.kind} is null or ${t.kind} in (${kindList})`),
    check('appliances_surge_class_check', sql`${t.surgeClass} is null or ${t.surgeClass} in (${surgeClassList})`),
    check('appliances_momentary_check', sql`(${t.kind} is not distinct from 'momentary') = (${t.burstSeconds} is not null and ${t.cyclesPerHour} is not null)`),
  ],
)

/**
 * Every write to an appliance, append-only: who (`updated_by` of the write), when, and the row before and after; before
 * is null for a new row. Added in the same `db.batch` as the write. No foreign key: an entry outlives its row.
 */
export const applianceChanges = pgTable('appliance_changes', {
  /** Grows with each entry, so the newest entries come first in descending id order. */
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  applianceId: text('appliance_id').notNull(),
  actor: text('actor').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  before: jsonb('before').$type<ApplianceRecord>(),
  after: jsonb('after').$type<ApplianceRecord>().notNull(),
})

const productKindList = sql.raw(PRODUCT_KINDS.map((k) => `'${k}'`).join(', '))
const productOriginList = sql.raw(PRODUCT_ORIGINS.map((o) => `'${o}'`).join(', '))

/** The product library: inverters and batteries as their datasheets state them. Zod-checked on read (product-repo). */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    /** productKey(): kind, the maker (the brand's whole name, minus trailing generic words) and the model, normalised. */
    key: text('key').notNull().unique(),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    makerUrl: text('maker_url'),
    datasheetUrl: text('datasheet_url').notNull(),
    specs: jsonb('specs').$type<InverterSpecs | BatterySpecs>().notNull(),
    extraSpecs: jsonb('extra_specs').$type<ExtraSpec[]>().notNull().default([]),
    price: jsonb('price').$type<ProductInput['price']>(),
    origin: text('origin').notNull(),
    conflicts: jsonb('conflicts').$type<ProductConflict[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    check('products_kind_check', sql`${t.kind} in (${productKindList})`),
    check('products_origin_check', sql`${t.origin} in (${productOriginList})`),
  ],
)

const quoteStatusList = sql.raw(QUOTE_STATUSES.map((s) => `'${s}'`).join(', '))

/** One uploaded quote and its background reading job. The file itself lives in private Blob storage. */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id').notNull(),
    projectId: text('project_id').notNull(),
    vendorLabel: text('vendor_label'),
    fileName: text('file_name').notNull(),
    blobPathname: text('blob_pathname').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    pages: integer('pages'),
    status: text('status').$type<QuoteStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** Retries the user asked for; capped at MAX_RETRIES (quote-guards), because retries don't count against the monthly limit. */
    retries: integer('retries').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    modelUsed: text('model_used'),
    usage: jsonb('usage').$type<QuoteUsage[]>(),
    extraction: jsonb('extraction').$type<StoredExtraction>(),
    overrides: jsonb('overrides').$type<Overrides>().notNull().default({}),
    totalOverride: doublePrecision('total_override'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    seenAt: timestamp('seen_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: 'quotes_project_fk', columns: [t.userId, t.projectId], foreignColumns: [projects.userId, projects.id] }).onDelete('cascade'),
    index('quotes_user_project_idx').on(t.userId, t.projectId),
    index('quotes_status_idx').on(t.status),
    check('quotes_status_check', sql`${t.status} in (${quoteStatusList})`),
  ],
)

/** Which items are must-haves for one project's verdict. No row means DEFAULT_MUSTS. */
export const quoteSettings = pgTable(
  'quote_settings',
  {
    userId: text('user_id').notNull(),
    projectId: text('project_id').notNull(),
    musts: jsonb('musts').$type<Partial<Musts>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    foreignKey({ name: 'quote_settings_project_fk', columns: [t.userId, t.projectId], foreignColumns: [projects.userId, projects.id] }).onDelete('cascade'),
  ],
)

/**
 * How many quotes a user has uploaded in a UTC month (`month` is its first day). It only ever goes up: deleting a
 * quote or a project does not give the monthly allowance back. Retries of a failed quote are not counted.
 */
export const quoteUsage = pgTable(
  'quote_usage',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    month: date('month', { mode: 'string' }).notNull(),
    uploads: integer('uploads').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] })],
)

/**
 * Model reads admitted in a UTC day across every account (uploads and retries), checked against QUOTES_DAILY_READS:
 * the owner's kill switch on spend. No user data. Like `quote_usage`, it only ever goes up.
 */
export const quoteDailyUsage = pgTable('quote_daily_usage', {
  day: date('day', { mode: 'string' }).primaryKey(),
  reads: integer('reads').notNull().default(0),
})

/**
 * Files of deleted quotes still waiting to leave storage. A row is added in the same transaction that deletes the
 * quote (or its project) and cleared once the file is gone; the sweep retries what's left. No foreign key: a row must
 * outlive the quote, the project and the user it came from.
 */
export const quoteFileTrash = pgTable('quote_file_trash', {
  pathname: text('pathname').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
