import { expect, test } from 'vitest'
import { assignSortOrders, diffAppliances, warnAppliances } from './catalog-diff'
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
