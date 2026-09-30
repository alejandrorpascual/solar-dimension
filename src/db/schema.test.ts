import { getTableColumns } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { projects, quotes, quoteSettings } from './schema'

test('projects table has the columns the store needs', () => {
  const cols = Object.keys(getTableColumns(projects)).sort()
  expect(cols).toEqual(['batteryUnit', 'chemistry', 'createdAt', 'custom', 'hours', 'id', 'name', 'qty', 'updatedAt', 'userId', 'volts'])
})

test('quotes table has the columns processing and the verdict need', () => {
  expect(Object.keys(getTableColumns(quotes)).sort()).toEqual([
    'attempts', 'blobPathname', 'claimedAt', 'createdAt', 'error', 'extraction', 'fileName', 'id', 'mime', 'modelUsed',
    'overrides', 'pages', 'processedAt', 'projectId', 'seenAt', 'sizeBytes', 'status', 'totalOverride', 'usage', 'userId', 'vendorLabel',
  ])
})

test('quote_settings holds the must-haves per project', () => {
  expect(Object.keys(getTableColumns(quoteSettings)).sort()).toEqual(['musts', 'projectId', 'updatedAt', 'userId'])
})
