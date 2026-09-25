import { expect, test } from 'vitest'
import { fmtDate, fmtHours, fmtInt, fmtKwh, fmtW } from './format'

test('formats numbers per locale', () => {
  expect(fmtInt(1234, 'en')).toBe('1,234')
  expect(fmtInt(1234, 'es')).toBe('1,234')
  expect(fmtW(12000, 'es')).toBe('12.0 kW')
  expect(fmtKwh(3675, 'es')).toBe('3.7 kWh')
  expect(fmtHours(10.25, 'es')).toBe('10.3 h')
})

test('keeps watts below 10 kW in W', () => {
  expect(fmtW(465, 'en')).toBe('465 W')
  expect(fmtW(9999, 'es')).toBe('9,999 W')
  expect(fmtW(10000, 'en')).toBe('10.0 kW')
})

test('formats a date the way each language writes it', () => {
  const day = new Date(2026, 8, 25)
  expect(fmtDate(day, 'en')).toBe('Sep 25, 2026')
  expect(fmtDate(day, 'es')).toMatch(/^25 sept?\.? 2026$/)
})
