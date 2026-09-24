import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

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
