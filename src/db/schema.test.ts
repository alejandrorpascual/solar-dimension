import { getTableColumns } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { appliances, projects, quotes, quoteSettings, quoteUsage } from './schema'

test('projects table has the columns the store needs', () => {
  const cols = Object.keys(getTableColumns(projects)).sort()
  expect(cols).toEqual(['batteryUnit', 'chemistry', 'createdAt', 'custom', 'dutyOverrides', 'electrical', 'hours', 'id', 'name', 'qty', 'requester', 'solar', 'updatedAt', 'userId', 'volts'])
})

test('project settings columns default to empty objects so an old client can never null them', () => {
  const { dutyOverrides, electrical } = getTableColumns(projects)
  expect(dutyOverrides.notNull).toBe(true)
  expect(dutyOverrides.default).toEqual({})
  expect(electrical.notNull).toBe(true)
  expect(electrical.default).toEqual({})
})

test('appliances carry an optional load kind, surge class and burst figures', () => {
  const cols = getTableColumns(appliances)
  for (const name of ['kind', 'surgeClass', 'burstSeconds', 'cyclesPerHour'] as const) expect(cols[name].notNull).toBe(false)
})

test('quotes table has the columns processing and the verdict need', () => {
  expect(Object.keys(getTableColumns(quotes)).sort()).toEqual([
    'attempts', 'blobPathname', 'claimedAt', 'createdAt', 'error', 'extraction', 'fileName', 'id', 'mime', 'modelUsed',
    'overrides', 'pages', 'processedAt', 'projectId', 'retries', 'seenAt', 'sizeBytes', 'status', 'totalOverride', 'usage', 'userId', 'vendorLabel',
  ])
})

test('a quote starts with no retries used', () => {
  const { retries } = getTableColumns(quotes)
  expect(retries.notNull).toBe(true)
  expect(retries.default).toBe(0)
})

test('quote_settings holds the must-haves per project', () => {
  expect(Object.keys(getTableColumns(quoteSettings)).sort()).toEqual(['musts', 'projectId', 'updatedAt', 'userId'])
})

test('quote_usage counts every upload per user and UTC month, and is never decremented', () => {
  expect(Object.keys(getTableColumns(quoteUsage)).sort()).toEqual(['month', 'uploads', 'userId'])
})
