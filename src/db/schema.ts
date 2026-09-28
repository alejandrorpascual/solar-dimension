import { sql } from 'drizzle-orm'
import { check, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { ApplianceLabels } from '../lib/catalog'
import { APPLIANCE_CATEGORIES } from '../lib/catalog-schema'

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
