import { getTableColumns } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { appliances } from '../db/schema'
import type { ApplianceInput, ApplianceRecord } from '../lib/catalog-schema'
import { APPLIANCE_SEED } from '../lib/catalog-snapshot'
import { listRecords, recentChanges, revertChange, setRetired, upsertAppliances } from './catalog-repo'

/** One statement as it reaches the database driver. */
interface Sent { sql: string; params: unknown[] }

/**
 * A stand-in for the Neon HTTP driver: drizzle builds the real SQL, and this records what is sent instead of sending
 * it. A statement awaited on its own is a read; statements handed to `transaction` together are one `db.batch`.
 */
const wire = vi.hoisted(() => ({
  reads: [] as Sent[],
  batches: [] as Sent[][],
  answer: (_sent: Sent): unknown[][] => [],
}))

vi.mock('../db/client', async () => {
  const { drizzle } = await import('drizzle-orm/neon-http')
  const schema = await import('../db/schema')
  const send = (sql: string, params: unknown[]) => {
    const sent: Sent = { sql, params }
    return {
      sent,
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
        wire.reads.push(sent)
        return Promise.resolve({ rows: wire.answer(sent), fields: [] }).then(ok, bad)
      },
    }
  }
  const transaction = async (queries: Array<{ sent: Sent }>) => {
    wire.batches.push(queries.map((q) => q.sent))
    return queries.map(() => ({ rows: [], fields: [] }))
  }
  return { db: drizzle({ client: Object.assign(send, { transaction }) as never, schema }) }
})

type Row = typeof appliances.$inferSelect

const fridge = APPLIANCE_SEED.find((r) => r.id === 'fridge')!
const fridgeInput: ApplianceInput = {
  id: fridge.id, category: fridge.category, watts: fridge.watts, surge: fridge.surge, duty: fridge.duty,
  tons: fridge.tons, acType: fridge.acType, labels: fridge.labels,
  kind: null, surgeClass: null, burstSeconds: null, cyclesPerHour: null,
}
/** The fridge as the repo reads it back from its row. */
const storedFridge: ApplianceRecord = { ...fridgeInput, sortOrder: fridge.sortOrder, retired: false }

const fridgeRow = (overrides: Partial<Row> = {}): Row => ({
  ...fridgeInput, sortOrder: fridge.sortOrder, retiredAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), updatedBy: 'seed',
  ...overrides,
} as Row)

/** A row as the driver returns it in array mode: the table's columns in order, timestamps as text. */
const onTheWire = (row: Row) => Object.keys(getTableColumns(appliances)).map((k) => {
  const v = row[k as keyof Row]
  return v instanceof Date ? v.toISOString() : v
})

/** The appliances table holds these rows; a read by id gets that row only. */
function store(...rows: Row[]) {
  wire.answer = ({ sql, params }) => {
    if (!sql.startsWith('select') || !sql.includes('from "appliances"')) return []
    const wanted = sql.includes('where') ? rows.filter((r) => r.id === params[0]) : rows
    return wanted.map(onTheWire)
  }
}

/** Params with the jsonb ones parsed back, so a logged row compares as an object. */
const decoded = (params: unknown[]) => params.map((p) => (typeof p === 'string' && p.startsWith('{') ? JSON.parse(p) : p))

beforeEach(() => {
  wire.reads.length = 0
  wire.batches.length = 0
  wire.answer = () => []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

test('a changed upsert sends the row and one change-log entry, before and after, in one transaction', async () => {
  store(fridgeRow())

  const result = await upsertAppliances([{ ...fridgeInput, watts: 180 }], 'admin-1')

  expect(result.updated).toEqual(['fridge'])
  expect(wire.batches).toHaveLength(1)
  const [write, log] = wire.batches[0]!
  expect(write!.sql).toMatch(/^insert into "appliances"/)
  expect(log!.sql).toMatch(/^insert into "appliance_changes"/)
  expect(decoded(log!.params)).toEqual(['fridge', 'admin-1', storedFridge, { ...storedFridge, watts: 180 }])
})

test('a new appliance is logged with no row before it', async () => {
  store()

  await upsertAppliances([fridgeInput], 'api-token')

  const [, log] = wire.batches[0]!
  expect(decoded(log!.params)).toEqual(['fridge', 'api-token', null, { ...storedFridge, sortOrder: 10 }])
})

test('a write over a stored row that fails the schema logs that row as the "before", not a new appliance', async () => {
  store(fridgeRow({ watts: 0, retiredAt: new Date('2026-10-20T00:00:00Z') }))

  await upsertAppliances([fridgeInput], 'api-token')

  const [, log] = wire.batches[0]!
  // The row stays retired (an upsert never touches `retired_at`), so the entry says it was and still is.
  expect(decoded(log!.params)).toEqual([
    'fridge', 'api-token',
    { ...storedFridge, watts: 0, retired: true },
    { ...storedFridge, sortOrder: 10, retired: true },
  ])
})

describe('sources', () => {
  const nameplate = { source: 'https://example.com/fridge-nameplate.jpg', asWritten: '1.2 A 115 V' }
  const datasheet = { source: 'https://example.com/fridge.pdf', asWritten: 'Rated input: 140 W' }
  /** The write's params with the jsonb ones parsed: the sources sent are one of them. */
  const writtenParams = () => decoded(wire.batches[0]![0]!.params)

  test('a write with sources sends them on insert and on update, and a read of the row returns them', async () => {
    store(fridgeRow({ sources: { watts: [nameplate] } }))

    await upsertAppliances([{ ...fridgeInput, sources: { watts: [datasheet] } }], 'api-token')

    expect(wire.batches[0]![0]!.sql).toContain('"sources" = excluded.sources')
    expect(writtenParams()).toContainEqual({ watts: [datasheet] })
    store(fridgeRow({ sources: { watts: [datasheet] } }))
    expect((await listRecords()).map((r) => r.sources)).toEqual([{ watts: [datasheet] }])
  })

  test('a write without sources sends the stored ones back, and logs them as kept', async () => {
    store(fridgeRow({ sources: { watts: [nameplate] } }))

    await upsertAppliances([{ ...fridgeInput, watts: 180 }], 'admin-1')

    expect(writtenParams()).toContainEqual({ watts: [nameplate] })
    const [, , before, after] = decoded(wire.batches[0]![1]!.params) as [string, string, ApplianceRecord, ApplianceRecord]
    expect([before.sources, after.sources, after.watts]).toEqual([{ watts: [nameplate] }, { watts: [nameplate] }, 180])
  })

  test('a write over a stored row that fails the schema keeps that row\'s sources too', async () => {
    store(fridgeRow({ watts: 0, sources: { watts: [nameplate] } }))

    await upsertAppliances([fridgeInput], 'api-token')

    expect(writtenParams()).toContainEqual({ watts: [nameplate] })
  })

  test('a write without sources over a row whose stored sources fail the schema drops them, so the row reads back', async () => {
    const insecure = { source: 'http://example.com/fridge-nameplate.jpg', asWritten: '1.2 A 115 V' }
    store(fridgeRow({ sources: { watts: [insecure] } }))
    expect(await listRecords()).toEqual([])

    await upsertAppliances([fridgeInput], 'api-token')

    expect(writtenParams()).not.toContainEqual({ watts: [insecure] })
    expect(writtenParams()).toContainEqual({})
    store(fridgeRow({ sources: {} }))
    expect((await listRecords()).map((r) => r.id)).toEqual(['fridge'])
  })

  test('a new appliance without sources is written with none', async () => {
    store()

    await upsertAppliances([fridgeInput], 'api-token')

    expect(writtenParams()).toContainEqual({})
  })
})

test('an unchanged write sends nothing to write and logs nothing', async () => {
  store(fridgeRow())

  const result = await upsertAppliances([fridgeInput], 'admin-1')

  expect(result).toMatchObject({ created: [], updated: [] })
  expect(wire.batches).toEqual([])
  expect(wire.reads.every((s) => s.sql.startsWith('select'))).toBe(true)
})

test('a retire and a restore each send the update and one entry in one transaction', async () => {
  store(fridgeRow())
  expect(await setRetired('fridge', true, 'admin-1')).toBe(true)

  store(fridgeRow({ retiredAt: new Date('2026-10-20T00:00:00Z') }))
  expect(await setRetired('fridge', false, 'admin-1')).toBe(true)

  expect(wire.batches.map((b) => b.map((s) => s.sql.split(' ').slice(0, 3).join(' ')))).toEqual([
    ['update "appliances" set', 'insert into "appliance_changes"'],
    ['update "appliances" set', 'insert into "appliance_changes"'],
  ])
  expect(decoded(wire.batches[0]![1]!.params)).toEqual(['fridge', 'admin-1', storedFridge, { ...storedFridge, retired: true }])
  expect(decoded(wire.batches[1]![1]!.params)).toEqual(['fridge', 'admin-1', { ...storedFridge, retired: true }, storedFridge])
})

test('retiring a retired appliance, or restoring an active one, writes and logs nothing', async () => {
  store(fridgeRow())
  expect(await setRetired('fridge', false, 'admin-1')).toBe(true)

  store(fridgeRow({ retiredAt: new Date('2026-10-20T00:00:00Z') }))
  expect(await setRetired('fridge', true, 'admin-1')).toBe(true)

  expect(wire.batches).toEqual([])
})

test('an unknown id, or a row that fails the schema, is not found and nothing is written', async () => {
  store(fridgeRow({ watts: 0 }))

  expect(await setRetired('kettle', true, 'admin-1')).toBe(false)
  expect(await setRetired('fridge', true, 'admin-1')).toBe(false)
  expect(wire.batches).toEqual([])
})

test('the recent changes are the 50 newest entries, newest first, with the email behind each', async () => {
  wire.answer = ({ sql }) => (sql.includes('from "appliance_changes"')
    ? [
        [7, '2026-10-22 15:04:05.123+00', 'user-1', 'owner@example.com', storedFridge, { ...storedFridge, retired: true }],
        [6, '2026-10-22 15:00:00+00', 'api-token', null, null, storedFridge],
      ]
    : [])

  const entries = await recentChanges()

  const [read] = wire.reads
  expect(read!.sql).toMatch(/left join "user" on "user"\."id" = "appliance_changes"\."actor"/)
  expect(read!.sql).toMatch(/order by "appliance_changes"\."id" desc limit \$1$/)
  expect(read!.params).toEqual([50])
  expect(entries).toEqual([
    { id: 7, changedAt: '2026-10-22T15:04:05.123Z', actor: 'user-1', actorEmail: 'owner@example.com', before: storedFridge, after: { ...storedFridge, retired: true } },
    { id: 6, changedAt: '2026-10-22T15:00:00.000Z', actor: 'api-token', actorEmail: null, before: null, after: storedFridge },
  ])
})

describe('reverting a change', () => {
  /** The appliances table holds `row`, and the change log one entry, id 7, whose "before" is `before`. */
  function storeWithEntry(row: Row | null, before: ApplianceRecord | null) {
    wire.answer = ({ sql, params }) => {
      if (sql.includes('from "appliance_changes"')) return params[0] === 7 ? [['fridge', before]] : []
      if (sql.startsWith('select') && sql.includes('from "appliances"')) return row && params[0] === row.id ? [onTheWire(row)] : []
      return []
    }
  }

  test('writes the entry\'s "before" back to the row and logs the revert as its own entry, in one transaction', async () => {
    storeWithEntry(fridgeRow({ watts: 180, retiredAt: new Date('2026-10-20T00:00:00Z') }), storedFridge)

    expect(await revertChange(7, 'admin-1')).toBe('reverted')

    expect(wire.batches).toHaveLength(1)
    const [write, log] = wire.batches[0]!
    expect(write!.sql).toMatch(/^update "appliances" set/)
    // Restored: the retired date is cleared, sent as a null param.
    const retiredAt = write!.sql.match(/"retired_at" = \$(\d+)/)
    expect(write!.params[Number(retiredAt![1]) - 1]).toBeNull()
    expect(decoded(write!.params)).toContain(150)
    expect(decoded(log!.params)).toEqual(['fridge', 'admin-1', { ...storedFridge, watts: 180, retired: true }, storedFridge])
  })

  test('putting back a retired "before" retires the row', async () => {
    storeWithEntry(fridgeRow(), { ...storedFridge, retired: true })

    expect(await revertChange(7, 'admin-1')).toBe('reverted')

    expect(wire.batches[0]![0]!.sql).toMatch(/"retired_at" = coalesce\("appliances"\."retired_at", now\(\)\)/)
  })

  test('a "before" logged without sources keeps the row\'s stored sources in the write and in the log', async () => {
    const sources = { watts: [{ source: 'https://example.com/fridge', asWritten: '150 W' }] }
    storeWithEntry(fridgeRow({ watts: 180, sources }), storedFridge)

    expect(await revertChange(7, 'admin-1')).toBe('reverted')

    const [write, log] = wire.batches[0]!
    expect(decoded(write!.params)).toContainEqual(sources)
    expect(decoded(log!.params)).toEqual(['fridge', 'admin-1', { ...storedFridge, watts: 180, sources }, { ...storedFridge, sources }])
  })

  test('a row that already holds the "before" values writes and logs nothing', async () => {
    storeWithEntry(fridgeRow(), storedFridge)

    expect(await revertChange(7, 'admin-1')).toBe('unchanged')
    expect(wire.batches).toEqual([])
  })

  test('an unknown entry, an entry whose appliance is gone, a creation and a "before" failing the schema write nothing', async () => {
    storeWithEntry(fridgeRow({ watts: 180 }), storedFridge)
    expect(await revertChange(8, 'admin-1')).toBe('not-found')

    storeWithEntry(null, storedFridge)
    expect(await revertChange(7, 'admin-1')).toBe('not-found')

    storeWithEntry(fridgeRow({ watts: 180 }), null)
    expect(await revertChange(7, 'admin-1')).toBe('created')

    storeWithEntry(fridgeRow({ watts: 180 }), { ...storedFridge, watts: 0 })
    expect(await revertChange(7, 'admin-1')).toBe('invalid')

    expect(wire.batches).toEqual([])
  })
})
