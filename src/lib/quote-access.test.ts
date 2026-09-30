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
  const trusted = { QUOTES_TRUSTED_EMAILS: ' Preview@Example.com , qa@example.com' }
  const password = (email: string) => ({ email, emailVerified: false, hasGoogle: false })
  test('a verified email can use quotes, listed or not', () => {
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: true, hasGoogle: false }, {})).toBe(true)
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: true, hasGoogle: false }, trusted)).toBe(true)
  })
  test('an account with Google linked can use quotes: Google only links its own verified, matching email', () => {
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: false, hasGoogle: true }, {})).toBe(true)
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: false, hasGoogle: true }, { VERCEL_ENV: 'production' })).toBe(true)
  })
  test('an unverified email can use quotes only when it is in the trusted list, case-insensitive and trimmed', () => {
    expect(canUseQuotes(password(' preview@EXAMPLE.com '), trusted)).toBe(true)
    expect(canUseQuotes(password('qa@example.com'), { ...trusted, VERCEL_ENV: 'preview' })).toBe(true)
    expect(canUseQuotes(password('eve@example.com'), trusted)).toBe(false)
    expect(canUseQuotes(password('preview@example.com'), {})).toBe(false)
    expect(canUseQuotes(password('preview@example.com'), { QUOTES_TRUSTED_EMAILS: '' })).toBe(false)
  })
  test('in production the trusted list is ignored, so a listed address registered unverified gets nothing', () => {
    expect(canUseQuotes(password('preview@example.com'), { ...trusted, VERCEL_ENV: 'production' })).toBe(false)
    expect(canUseQuotes({ email: 'preview@example.com', emailVerified: true, hasGoogle: false }, { ...trusted, VERCEL_ENV: 'production' })).toBe(true)
  })
  test('no user cannot use quotes', () => {
    expect(canUseQuotes(null, trusted)).toBe(false)
    expect(canUseQuotes(undefined, trusted)).toBe(false)
  })
})
