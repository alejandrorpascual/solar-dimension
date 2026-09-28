import { expect, test } from 'vitest'
import { assignSortOrders, diffAppliances } from './catalog-diff'
import { APPLIANCE_SEED } from './catalog-snapshot'

const fridge = APPLIANCE_SEED.find((r) => r.id === 'fridge')!
const fridgeInput = {
  id: fridge.id, category: fridge.category, watts: fridge.watts, surge: fridge.surge, duty: fridge.duty,
  tons: fridge.tons, acType: fridge.acType, labels: fridge.labels,
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
