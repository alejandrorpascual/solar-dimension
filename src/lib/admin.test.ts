import { expect, test } from 'vitest'
import { isAdmin } from './admin'

test('an admin has a verified email listed in ADMIN_EMAILS, case-insensitive', () => {
  const raw = ' Alex@Example.com , other@example.com'
  expect(isAdmin({ email: 'alex@example.com', emailVerified: true }, raw)).toBe(true)
  expect(isAdmin({ email: 'alex@example.com', emailVerified: false }, raw)).toBe(false)
  expect(isAdmin({ email: 'eve@example.com', emailVerified: true }, raw)).toBe(false)
  expect(isAdmin({ email: 'alex@example.com', emailVerified: true }, undefined)).toBe(false)
  expect(isAdmin(null, raw)).toBe(false)
})
