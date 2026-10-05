import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '../db/client'
import * as schema from '../db/auth-schema'
import { googleProvider } from './auth-google'
import { authBaseURL, authTrustedOrigins } from './auth-url'

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error('BETTER_AUTH_SECRET is not set.')

const google = googleProvider(process.env)

export const auth = betterAuth({
  secret,
  baseURL: authBaseURL(process.env),
  trustedOrigins: authTrustedOrigins(process.env),
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  // No trustedProviders: an unverified password account must never be linked to a Google sign-in implicitly.
  socialProviders: google ? { google } : {},
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  plugins: [tanstackStartCookies()],
})
