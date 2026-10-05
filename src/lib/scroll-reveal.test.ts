import { describe, expect, test } from 'vitest'
import { revealOffset } from './scroll-reveal'

const box = { top: 100, bottom: 500 }

describe('revealOffset', () => {
  test('a field already inside the box, clear of the margin, needs no scroll', () => {
    expect(revealOffset({ top: 200, bottom: 244 }, box, 16)).toBe(0)
  })
  test('a field below the visible part scrolls down until it sits the margin above the bottom', () => {
    expect(revealOffset({ top: 600, bottom: 644 }, box, 16)).toBe(644 - 500 + 16)
  })
  test('a field above the visible part scrolls up until it sits the margin below the top', () => {
    expect(revealOffset({ top: 40, bottom: 84 }, box, 16)).toBe(40 - 100 - 16)
  })
  test('a field taller than the box lines its top up with the box instead of its bottom', () => {
    expect(revealOffset({ top: 300, bottom: 900 }, box, 16)).toBe(300 - 100 - 16)
  })
})
