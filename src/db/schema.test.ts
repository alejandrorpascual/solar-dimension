import { getTableColumns } from 'drizzle-orm'
import { expect, test } from 'vitest'
import { projects } from './schema'

test('projects table has the columns the store needs', () => {
  const cols = Object.keys(getTableColumns(projects)).sort()
  expect(cols).toEqual(['chemistry', 'createdAt', 'custom', 'hours', 'id', 'name', 'qty', 'updatedAt', 'userId', 'volts'])
})
