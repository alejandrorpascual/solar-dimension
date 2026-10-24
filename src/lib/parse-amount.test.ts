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

test('refuses a word beside the amount that is not a currency code', () => {
  // "650 mil" is Spanish for 650 thousand: reading it as 650 would rank the quote a thousand times too cheap.
  for (const bad of ['650 mil', '1,5 mil', '6480 IVA', '6485 más', 'mil 650']) {
    expect(parseAmount(bad), bad).toBeNull()
  }
  expect(parseAmount('cop 1.000.000')).toBe(1_000_000)
})

test('refuses digit groups that are not thousands', () => {
  // Grouping splits thousands, so every group after the first has three digits: "6485 18" is not 648,518.
  for (const bad of ['6485 18', '1,2345', '64 85']) {
    expect(parseAmount(bad), bad).toBeNull()
  }
})

test('refuses digits too many to be a number', () => {
  expect(parseAmount('9'.repeat(400))).toBeNull()
})
