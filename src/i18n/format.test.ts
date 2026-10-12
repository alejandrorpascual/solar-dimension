import { describe, expect, test } from 'vitest'
import { fmtDate, fmtDecimal, fmtHours, fmtInt, fmtInverter, fmtKw, fmtKwh, fmtList, fmtMoney, fmtW } from './format'

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

test('formats watts as kilowatts with one decimal', () => {
  expect(fmtKw(5500, 'en')).toBe('5.5 kW')
  expect(fmtKw(5500, 'es')).toBe('5.5 kW')
})

test('formats a date the way each language writes it', () => {
  const day = new Date(2026, 8, 25)
  expect(fmtDate(day, 'en')).toBe('Sep 25, 2026')
  expect(fmtDate(day, 'es')).toMatch(/^25 sept?\.? 2026$/)
})

describe('fmtMoney and fmtList', () => {
  test('whole units in the quote currency', () => {
    expect(fmtMoney(6480, 'USD', 'en')).toBe('$6,480')
    expect(fmtMoney(6480, 'USD', 'es')).toMatch(/6[.,]?480/)
  })
  test('an unknown currency code falls back to the number and the code', () => {
    expect(fmtMoney(10, 'ZZZZ', 'en')).toBe('10 ZZZZ')
  })
  test('lists join with "and" / "y"', () => {
    expect(fmtList(['a charger', 'a fuse'], 'en')).toBe('a charger and a fuse')
    expect(fmtList(['un cargador', 'un fusible'], 'es')).toBe('un cargador y un fusible')
  })
})

describe('fmtDecimal', () => {
  test('always shows the given number of decimals', () => {
    expect(fmtDecimal(3.1088, 1, 'en')).toBe('3.1')
    expect(fmtDecimal(2, 1, 'en')).toBe('2.0')
    expect(fmtDecimal(1.15, 2, 'en')).toBe('1.15')
    expect(fmtDecimal(3.1088, 1, 'es')).toBe((3.1).toLocaleString('es-419', { minimumFractionDigits: 1 }))
  })
})

test('fmtInverter names one unit by its size and a parallel set by its count', () => {
  expect(fmtInverter({ count: 1, unitW: 3000 }, 'en')).toBe('3,000 W')
  expect(fmtInverter({ count: 2, unitW: 8000 }, 'en')).toBe('2 × 8,000 W')
  expect(fmtInverter({ count: 3, unitW: 12000 }, 'es')).toBe('3 × 12.0 kW')
})
