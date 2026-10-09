import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { seedSql, seedSqlFull } from './catalog-seed'
import { APPLIANCE_SEED, APPLIANCE_SEED_MOMENTARY } from './catalog-snapshot'

test('escapes quotes and writes nulls, jsonb and an idempotent conflict clause', () => {
  const sql = seedSql([{ ...APPLIANCE_SEED[0]!, labels: { en: { name: "Kid's fridge", note: '' }, es: { name: 'Nevera', note: '' } } }])
  expect(sql).toContain(`'{"en":{"name":"Kid''s fridge","note":""},"es":{"name":"Nevera","note":""}}'::jsonb`)
  expect(sql).toContain('NULL, NULL')
  expect(sql.trim().endsWith('ON CONFLICT ("id") DO NOTHING;')).toBe(true)
})

test('the seed migration is exactly the bundled snapshot (no drift)', () => {
  expect(readFileSync('drizzle/0004_seed_appliances.sql', 'utf8')).toBe(seedSql(APPLIANCE_SEED))
})

test('the momentary seed writes the load-kind columns and is exactly migration 0012 (no drift)', () => {
  const sql = seedSqlFull(APPLIANCE_SEED_MOMENTARY)
  expect(sql).toContain('"kind", "surge_class", "burst_seconds", "cycles_per_hour"')
  expect(sql).toContain("'momentary', 'motor', 20, 6)")
  expect(readFileSync('drizzle/0012_momentary_appliances.sql', 'utf8')).toBe(sql)
})

test('a record without the load-kind fields seeds them as NULL', () => {
  expect(seedSqlFull([APPLIANCE_SEED[0]!])).toContain(", 'seed', NULL, NULL, NULL, NULL)")
})
