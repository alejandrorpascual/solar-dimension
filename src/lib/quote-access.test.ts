import { describe, expect, test } from 'vitest'
import { parseEmailList } from './email-list'
import { canUseQuotes, googleIdTokenVerifies } from './quote-access'

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

/** An unsigned JWT with this payload: the app reads only the payload of the token Google's token endpoint gave. */
const idToken = (payload: object): string => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.')

describe('googleIdTokenVerifies', () => {
  test('a token whose email is verified and matches the user, case-insensitively, verifies', () => {
    expect(googleIdTokenVerifies(idToken({ email: 'Alex@Example.com', email_verified: true }), ' alex@example.com ')).toBe(true)
  })
  test('an email Google did not verify does not', () => {
    expect(googleIdTokenVerifies(idToken({ email: 'alex@example.com', email_verified: false }), 'alex@example.com')).toBe(false)
    expect(googleIdTokenVerifies(idToken({ email: 'alex@example.com' }), 'alex@example.com')).toBe(false)
  })
  test('a claim of "true" sent as a string verifies, as Better Auth treats it when linking', () => {
    expect(googleIdTokenVerifies(idToken({ email: 'alex@example.com', email_verified: 'true' }), 'alex@example.com')).toBe(true)
  })
  test('no other string or truthy value verifies', () => {
    for (const claim of ['false', 'yes', '1', 'TRUE', 1, {}]) {
      expect(googleIdTokenVerifies(idToken({ email: 'alex@example.com', email_verified: claim }), 'alex@example.com'), String(claim)).toBe(false)
    }
  })
  test('a different email does not', () => {
    expect(googleIdTokenVerifies(idToken({ email: 'eve@example.com', email_verified: true }), 'alex@example.com')).toBe(false)
    expect(googleIdTokenVerifies(idToken({ email_verified: true }), 'alex@example.com')).toBe(false)
  })
  test('a malformed or missing token does not', () => {
    expect(googleIdTokenVerifies('not-a-jwt', 'alex@example.com')).toBe(false)
    expect(googleIdTokenVerifies('a.%%%.c', 'alex@example.com')).toBe(false)
    expect(googleIdTokenVerifies(['e30', Buffer.from('[1]').toString('base64url'), 's'].join('.'), 'alex@example.com')).toBe(false)
    expect(googleIdTokenVerifies(null, 'alex@example.com')).toBe(false)
    expect(googleIdTokenVerifies(undefined, 'alex@example.com')).toBe(false)
    expect(googleIdTokenVerifies('', 'alex@example.com')).toBe(false)
  })
})

describe('canUseQuotes', () => {
  const trusted = { QUOTES_TRUSTED_EMAILS: ' Preview@Example.com , qa@example.com' }
  const password = (email: string) => ({ email, emailVerified: false, googleIdTokens: [] })
  const withGoogle = (claims: object) => ({ email: 'anyone@example.com', emailVerified: false, googleIdTokens: [idToken(claims)] })
  test('a verified email can use quotes, listed or not', () => {
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: true, googleIdTokens: [] }, {})).toBe(true)
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: true, googleIdTokens: [] }, trusted)).toBe(true)
  })
  test('an account with a Google row whose token verifies its email can use quotes, in production too', () => {
    const verified = withGoogle({ email: 'anyone@example.com', email_verified: true })
    expect(canUseQuotes(verified, {})).toBe(true)
    expect(canUseQuotes(verified, { VERCEL_ENV: 'production' })).toBe(true)
    expect(canUseQuotes({ ...verified, googleIdTokens: [null, ...verified.googleIdTokens] }, {})).toBe(true)
  })
  test('a Google row alone is not enough: a Google sign-up with an unverified or different email gets nothing', () => {
    expect(canUseQuotes(withGoogle({ email: 'anyone@example.com', email_verified: false }), {})).toBe(false)
    expect(canUseQuotes(withGoogle({ email: 'other@example.com', email_verified: true }), {})).toBe(false)
    expect(canUseQuotes({ email: 'anyone@example.com', emailVerified: false, googleIdTokens: [null] }, {})).toBe(false)
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
    expect(canUseQuotes({ email: 'preview@example.com', emailVerified: true, googleIdTokens: [] }, { ...trusted, VERCEL_ENV: 'production' })).toBe(true)
  })
  test('no user cannot use quotes', () => {
    expect(canUseQuotes(null, trusted)).toBe(false)
    expect(canUseQuotes(undefined, trusted)).toBe(false)
  })
})
