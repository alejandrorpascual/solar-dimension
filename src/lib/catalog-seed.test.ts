import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { seedSql } from './catalog-seed'
import { APPLIANCE_SEED } from './catalog-snapshot'

test('escapes quotes and writes nulls, jsonb and an idempotent conflict clause', () => {
  const sql = seedSql([{ ...APPLIANCE_SEED[0]!, labels: { en: { name: "Kid's fridge", note: '' }, es: { name: 'Nevera', note: '' } } }])
  expect(sql).toContain(`'{"en":{"name":"Kid''s fridge","note":""},"es":{"name":"Nevera","note":""}}'::jsonb`)
  expect(sql).toContain('NULL, NULL')
  expect(sql.trim().endsWith('ON CONFLICT ("id") DO NOTHING;')).toBe(true)
})

test('the seed migration is exactly the bundled snapshot (no drift)', () => {
  expect(readFileSync('drizzle/0004_seed_appliances.sql', 'utf8')).toBe(seedSql(APPLIANCE_SEED))
})
