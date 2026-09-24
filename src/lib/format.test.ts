import { expect, test } from 'vitest'
import { fmtHours, fmtInt, fmtKwh, fmtW } from './format'

test('fmtInt groups thousands', () => {
  expect(fmtInt(1234.6)).toBe('1,235')
})

test('fmtW switches to kW at 10 kW', () => {
  expect(fmtW(465)).toBe('465 W')
  expect(fmtW(9999)).toBe('9,999 W')
  expect(fmtW(12000)).toBe('12.0 kW')
})

test('fmtKwh has one decimal', () => {
  expect(fmtKwh(3675)).toBe('3.7 kWh')
})

test('fmtHours rounds to one decimal and drops trailing zero', () => {
  expect(fmtHours(19.98)).toBe('20 h')
  expect(fmtHours(10.25)).toBe('10.3 h')
})
