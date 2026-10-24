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

test('reads a currency symbol or code written before or after the amount', () => {
  expect(parseAmount('$6,480.50')).toBe(6480.5)
  expect(parseAmount('RD$ 6,480')).toBe(6480)
  expect(parseAmount('6.480,50 €')).toBe(6480.5)
  expect(parseAmount('DOP 6,480')).toBe(6480)
  expect(parseAmount('6480 usd')).toBe(6480)
  // What the page shows for an amount, a non-breaking space after the code included, reads back as that amount.
  expect(parseAmount('DOP 64,800,000')).toBe(64_800_000)
})

test('refuses anything but digits, separators, spaces and one currency at either end', () => {
  for (const bad of ['6485 + 18%', '6,485.00 (2 pagos)', '1e5', '6480 x 2', '$6,480 - 10%', '6..480', '6,480.', '.50', 'RD$ 6,480 USD $']) {
    expect(parseAmount(bad), bad).toBeNull()
  }
})

test('refuses digits too many to be a number', () => {
  expect(parseAmount('9'.repeat(400))).toBeNull()
})
