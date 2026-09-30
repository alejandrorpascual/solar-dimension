import { expect, test } from 'vitest'
import { plotScale } from './quote-plot'

test('covers every value with evenly spaced round ticks', () => {
  const s = plotScale([5950, 6150, 6480, 7300])
  expect(s.ticks).toEqual([5500, 6000, 6500, 7000, 7500])
  expect(s.pos(7300)).toBeCloseTo(90)
  for (const v of [5950, 6150, 6480, 7300]) expect(s.pos(v)).toBeGreaterThanOrEqual(0)
})

test('a single value still gets a readable range, never below zero', () => {
  const s = plotScale([100])
  expect(s.min).toBeGreaterThanOrEqual(0)
  expect(s.max).toBeGreaterThan(100)
  expect(s.pos(100)).toBeGreaterThan(0)
  expect(s.pos(100)).toBeLessThan(100)
})
