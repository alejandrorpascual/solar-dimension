import { describe, expect, test } from 'vitest'
import { parseEmailList } from './email-list'
import { canUseQuotes } from './quote-access'

describe('parseEmailList', () => {
  test('splits on commas, trims, lower-cases and drops blanks', () => {
    expect([...parseEmailList(' Alex@Example.com , ,other@example.com,')]).toEqual(['alex@example.com', 'other@example.com'])
  })
  test('an unset or empty list is empty', () => {
    expect(parseEmailList(undefined).size).toBe(0)
    expect(parseEmailList('').size).toBe(0)
    expect(parseEmailList(' , ').size).toBe(0)
  })
})

describe('canUseQuotes', () => {
  const trusted = ' Preview@Example.com , qa@example.com'
  test('a verified email can use quotes, listed or not', () => {
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: true }, undefined)).toBe(true)
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: true }, trusted)).toBe(true)
  })
  test('an unverified email can use quotes only when it is in the trusted list, case-insensitive and trimmed', () => {
    expect(canUseQuotes({ email: ' preview@EXAMPLE.com ', emailVerified: false }, trusted)).toBe(true)
    expect(canUseQuotes({ email: 'qa@example.com', emailVerified: false }, trusted)).toBe(true)
    expect(canUseQuotes({ email: 'eve@example.com', emailVerified: false }, trusted)).toBe(false)
    expect(canUseQuotes({ email: 'preview@example.com', emailVerified: false }, undefined)).toBe(false)
    expect(canUseQuotes({ email: 'preview@example.com', emailVerified: false }, '')).toBe(false)
  })
  test('no user cannot use quotes', () => {
    expect(canUseQuotes(null, trusted)).toBe(false)
    expect(canUseQuotes(undefined, trusted)).toBe(false)
  })
})
