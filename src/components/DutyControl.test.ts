import { expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { compute } from '../lib/sizing'
import { dutyOptions } from './DutyControl'

const selected = (id: string) => compute({ qty: { [id]: 1 }, hours: 24, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT).items[0]!

test('a microwave can be set below its typical 8%, to 5% (the engine floor) or 10%', () => {
  expect(dutyOptions(selected('micro'))).toEqual([0.05, 0.08, 0.1, 0.25, 0.5, 0.75, 1])
})

test('a fridge keeps its typical 35% among the presets, which now start at 5%', () => {
  expect(dutyOptions(selected('fridge'))).toEqual([0.05, 0.1, 0.25, 0.35, 0.5, 0.75, 1])
})
