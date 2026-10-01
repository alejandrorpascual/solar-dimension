import { expect, test } from 'vitest'
import { parseAmount } from './parse-amount'

test('reads English and Spanish separators', () => {
  expect(parseAmount('6,480')).toBe(6480)
  expect(parseAmount('6.480')).toBe(6480)
  expect(parseAmount('6,480.50')).toBe(6480.5)
  expect(parseAmount('6.480,50')).toBe(6480.5)
  expect(parseAmount('$ 6 480')).toBe(6480)
  expect(parseAmount('12,5')).toBe(12.5)
})

test('returns null for anything without digits, or negative', () => {
  expect(parseAmount('abc')).toBeNull()
  expect(parseAmount('')).toBeNull()
  expect(parseAmount('-5')).toBeNull()
})
