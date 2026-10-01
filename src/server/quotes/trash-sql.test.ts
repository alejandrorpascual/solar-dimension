import { and, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'
import { quotes } from '../../db/schema'
import { trashQuoteFiles } from './repo'

// A real query builder with a client that never connects: only toSQL() is called.
vi.mock('../../db/client', async () => {
  const { drizzle } = await import('drizzle-orm/neon-http')
  const { neon } = await import('@neondatabase/serverless')
  return { db: drizzle({ client: neon('postgresql://user:pass@db.invalid/test') }) }
})

describe('trashQuoteFiles', () => {
  test('copies the paths of the quotes it selects into the trash, skipping ones already there', () => {
    const { sql, params } = trashQuoteFiles(and(eq(quotes.id, 'q1'), eq(quotes.userId, 'u1'))).toSQL()
    expect(sql).toMatch(/^insert into "quote_file_trash" \("pathname", "created_at"\) select "blob_pathname", now\(\) as "created_at" from "quotes" where/)
    expect(sql).toContain('("quotes"."id" = $1 and "quotes"."user_id" = $2)')
    expect(sql).toMatch(/on conflict do nothing$/)
    expect(params).toEqual(['q1', 'u1'])
  })
})
