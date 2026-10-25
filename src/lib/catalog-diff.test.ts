import { describe, expect, test } from 'vitest'
import { assignSortOrders, diffAppliances, planUpsert, retireWrite, revertWrite, warnAppliances, writtenFields } from './catalog-diff'
import { ApplianceSchema } from './catalog-schema'
import { APPLIANCE_SEED } from './catalog-snapshot'

const fridge = APPLIANCE_SEED.find((r) => r.id === 'fridge')!
const fridgeInput = {
  id: fridge.id, category: fridge.category, watts: fridge.watts, surge: fridge.surge, duty: fridge.duty,
  tons: fridge.tons, acType: fridge.acType, labels: fridge.labels,
  kind: null, surgeClass: null, burstSeconds: null, cyclesPerHour: null,
}

test('marks new, changed (with the fields) and unchanged items', () => {
  const stove = { ...fridgeInput, id: 'stove', labels: { en: { name: 'Stove', note: '' }, es: { name: 'Estufa', note: '' } } }
  const changes = diffAppliances(APPLIANCE_SEED, [stove, { ...fridgeInput, watts: 180, surge: 1200 }, fridgeInput])
  expect(changes).toEqual([
    { id: 'stove', kind: 'new' },
    { id: 'fridge', kind: 'changed', fields: [{ field: 'watts', from: 150, to: 180 }] },
    { id: 'fridge', kind: 'unchanged' },
  ])
})

test('ignores key order inside labels', () => {
  const reordered = { ...fridgeInput, labels: { es: { note: fridge.labels.es.note, name: fridge.labels.es.name }, en: fridge.labels.en } }
  expect(diffAppliances(APPLIANCE_SEED, [reordered])).toEqual([{ id: 'fridge', kind: 'unchanged' }])
})

test('appends new items after the highest sort order and keeps existing ones in place', () => {
  const max = Math.max(...APPLIANCE_SEED.map((r) => r.sortOrder))
  const out = assignSortOrders(APPLIANCE_SEED, [{ ...fridgeInput, id: 'a-new' }, { ...fridgeInput, id: 'b-new' }, fridgeInput])
  expect(out.map((r) => [r.id, r.sortOrder, r.retired])).toEqual([['a-new', max + 10, false], ['b-new', max + 20, false], ['fridge', fridge.sortOrder, false]])
})

test('a requested sort order counts as a change; leaving it out never does', () => {
  expect(diffAppliances(APPLIANCE_SEED, [{ ...fridgeInput, sortOrder: 5 }])).toEqual([
    { id: 'fridge', kind: 'changed', fields: [{ field: 'sortOrder', from: fridge.sortOrder, to: 5 }] },
  ])
  expect(diffAppliances(APPLIANCE_SEED, [{ ...fridgeInput, sortOrder: fridge.sortOrder }])).toEqual([{ id: 'fridge', kind: 'unchanged' }])
  expect(diffAppliances(APPLIANCE_SEED, [fridgeInput])).toEqual([{ id: 'fridge', kind: 'unchanged' }])
})

test('an explicit sortOrder wins', () => {
  expect(assignSortOrders(APPLIANCE_SEED, [{ ...fridgeInput, sortOrder: 5 }])[0]!.sortOrder).toBe(5)
})

test('a surge class or load kind change counts as a change, and a record that never had them matches null', () => {
  const current = { ...APPLIANCE_SEED[0]!, kind: undefined, surgeClass: undefined, burstSeconds: undefined, cyclesPerHour: undefined }
  const same = ApplianceSchema.parse(Object.fromEntries(Object.entries(APPLIANCE_SEED[0]!).filter(([k]) => k !== 'retired')))
  expect(diffAppliances([current], [same])).toEqual([{ id: current.id, kind: 'unchanged' }])
  const classed = { ...same, surgeClass: 'compressor' as const }
  expect(diffAppliances([current], [classed])).toEqual([{ id: current.id, kind: 'changed', fields: [{ field: 'surgeClass', from: undefined, to: 'compressor' }] }])
})

test('warns when watts, surge or duty move more than half away from the stored row, and lists only items that warn', () => {
  const warnings = warnAppliances(APPLIANCE_SEED, [{ ...fridgeInput, watts: 240 }, { ...fridgeInput, id: 'fridge-2' }])

  expect(warnings).toEqual([{ id: 'fridge', messages: ['Running watts from the stored 150 to 240 is a change of 60%: check the digits and the unit.'] }])
  expect(warnAppliances(APPLIANCE_SEED, [{ ...fridgeInput, watts: 210, duty: 0.5 }])).toEqual([])
})

test('a slipped digit warns once for each field it moved', () => {
  const warnings = warnAppliances(APPLIANCE_SEED, [{ ...fridgeInput, watts: 15, surge: 15, duty: 0.7 }])

  expect(warnings).toEqual([{
    id: 'fridge',
    messages: [
      'Running watts from the stored 150 to 15 is a change of 90%: check the digits and the unit.',
      'Surge from the stored 1200 to 15 is a change of 99%: check the digits and the unit.',
      'Duty from the stored 0.35 to 0.7 is a change of 100%: check the digits and the unit.',
    ],
  }])
})

test('a new item is checked on its own, with no stored row to compare against', () => {
  const pump = { ...fridgeInput, id: 'pump', category: 'Utility' as const, watts: 100, surge: 3000 }

  expect(warnAppliances(APPLIANCE_SEED, [pump])).toEqual([{ id: 'pump', messages: [expect.stringMatching(/^Surge is 30× the running watts/)] }])
})

test('a changed upsert writes one entry with the row before and after', () => {
  const { writes } = planUpsert(APPLIANCE_SEED, [{ ...fridgeInput, watts: 180 }])

  expect(writes).toEqual([{ before: fridge, after: { ...fridgeInput, watts: 180, sortOrder: fridge.sortOrder, retired: false } }])
  expect(writtenFields(writes[0]!)).toEqual([{ field: 'watts', from: 150, to: 180 }])
})

test('an unchanged item writes nothing, and a new one is written with no row before it', () => {
  const stove = { ...fridgeInput, id: 'stove' }

  const { changes, writes } = planUpsert(APPLIANCE_SEED, [fridgeInput, stove])

  expect(changes.map((c) => c.kind)).toEqual(['unchanged', 'new'])
  expect(writes.map((w) => [w.after.id, w.before])).toEqual([['stove', null]])
  expect(writtenFields(writes[0]!)).toEqual([])
})

describe('sources', () => {
  const nameplate = { source: 'https://example.com/fridge-nameplate.jpg', asWritten: '1.2 A 115 V' }
  const datasheet = { source: 'https://example.com/fridge.pdf', asWritten: 'Locked rotor current: 10 A' }
  const sourcedFridge = { ...fridge, sources: { watts: [nameplate] } }

  test('a write without sources keeps the stored ones, and they never count as a change', () => {
    expect(diffAppliances([sourcedFridge], [fridgeInput])).toEqual([{ id: 'fridge', kind: 'unchanged' }])

    const { writes } = planUpsert([sourcedFridge], [{ ...fridgeInput, watts: 180 }])

    expect(writes.map((w) => w.after.sources)).toEqual([{ watts: [nameplate] }])
    expect(writtenFields(writes[0]!)).toEqual([{ field: 'watts', from: 150, to: 180 }])
  })

  test('a write with sources replaces them all, and an empty set clears them', () => {
    const replaced = planUpsert([sourcedFridge], [{ ...fridgeInput, sources: { surge: [datasheet] } }])
    const cleared = planUpsert([sourcedFridge], [{ ...fridgeInput, sources: {} }])

    expect(replaced.changes).toEqual([
      { id: 'fridge', kind: 'changed', fields: [{ field: 'sources', from: { watts: [nameplate] }, to: { surge: [datasheet] } }] },
    ])
    expect(replaced.writes.map((w) => w.after.sources)).toEqual([{ surge: [datasheet] }])
    expect(writtenFields(replaced.writes[0]!)).toEqual([{ field: 'sources', from: { watts: [nameplate] }, to: { surge: [datasheet] } }])
    expect(cleared.writes.map((w) => w.after.sources)).toEqual([{}])
  })

  test('the same sources again, in any key order, are unchanged', () => {
    const reordered = { sources: { watts: [{ asWritten: nameplate.asWritten, source: nameplate.source }] } }

    expect(diffAppliances([sourcedFridge], [{ ...fridgeInput, ...reordered }])).toEqual([{ id: 'fridge', kind: 'unchanged' }])
  })
})

test('a retire and a restore are each one write that flips only the retired flag; repeating one writes nothing', () => {
  const retired = retireWrite(fridge, true)
  expect(retired).toEqual({ before: fridge, after: { ...fridge, retired: true } })
  expect(writtenFields(retired!)).toEqual([{ field: 'retired', from: false, to: true }])

  const restored = retireWrite({ ...fridge, retired: true }, false)
  expect(writtenFields(restored!)).toEqual([{ field: 'retired', from: true, to: false }])

  expect(retireWrite(fridge, false)).toBeNull()
})

describe('reverting a logged change', () => {
  const stored = { ...fridgeInput, sortOrder: fridge.sortOrder, retired: false }

  test('writes the row back to the entry\'s "before", every logged field included, as one write', () => {
    const before = { ...stored, watts: 150, retired: true, sortOrder: 5, sources: {} }
    const current = { ...stored, watts: 180, sources: {} }
    const write = revertWrite(current, before)
    expect(write).toEqual({ before: current, after: before })
    expect(typeof write === 'object' && writtenFields(write)).toEqual([
      { field: 'watts', from: 180, to: 150 },
      { field: 'sortOrder', from: fridge.sortOrder, to: 5 },
      { field: 'retired', from: false, to: true },
    ])
  })

  test('a row that already holds the "before" values writes nothing', () => {
    expect(revertWrite(stored, { ...stored })).toBe('unchanged')
  })

  test('an entry that created the appliance has no "before" to put back', () => {
    expect(revertWrite(stored, null)).toBe('created')
  })

  test('a "before" that fails the schema (a hand-edited row) is not put back', () => {
    expect(revertWrite(stored, { ...stored, watts: 0 })).toBe('invalid')
  })
})
