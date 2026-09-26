import { describe, expect, test } from 'vitest'
import { googleProvider } from './auth-google'

describe('googleProvider', () => {
  test('is off unless both the client id and secret are set', () => {
    expect(googleProvider({})).toBeNull()
    expect(googleProvider({ GOOGLE_CLIENT_ID: 'id' })).toBeNull()
    expect(googleProvider({ GOOGLE_CLIENT_SECRET: 'secret' })).toBeNull()
    expect(googleProvider({ GOOGLE_CLIENT_ID: ' ', GOOGLE_CLIENT_SECRET: 'secret' })).toBeNull()
  })

  test('asks Google to show the account chooser', () => {
    expect(googleProvider({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }))
      .toEqual({ clientId: 'id', clientSecret: 'secret', prompt: 'select_account' })
  })
})
