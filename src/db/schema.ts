import { sql } from 'drizzle-orm'
import { check, date, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { ApplianceLabels } from '../lib/catalog'
import { APPLIANCE_CATEGORIES } from '../lib/catalog-schema'
import type { Musts, Overrides } from '../lib/quote-items'
import type { Requester } from '../lib/requester'
import type { Solar } from '../lib/schema'
import { QUOTE_STATUSES, type StoredExtraction, type QuoteStatus, type QuoteUsage } from '../lib/quote-schema'

import { user } from './auth-schema'

export * from './auth-schema'

export const projects = pgTable(
  'projects',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    qty: jsonb('qty').$type<Record<string, number>>().notNull(),
    custom: jsonb('custom').$type<Array<{ id: string; name: string; watts: number; surge: number; note: string }>>().notNull(),
    hours: integer('hours').notNull(),
    volts: integer('volts').notNull(),
    chemistry: text('chemistry').notNull(),
    batteryUnit: text('battery_unit'),
    /** Who asked for the kit (printed on the spec sheet); null until added. Validated by RequesterSchema on read. */
    requester: jsonb('requester').$type<Requester>(),
    /** Panels on the roof (step 3); null for a battery-only kit. Validated by SolarSchema on read. */
    solar: jsonb('solar').$type<Solar>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

const categoryList = sql.raw(APPLIANCE_CATEGORIES.map((c) => `'${c}'`).join(', '))

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
