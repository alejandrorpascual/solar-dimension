import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '../db/client'
import * as schema from '../db/auth-schema'
import { authBaseURL } from './auth-url'

const secret = process.env.BETTER_AUTH_SECRET
if (!secret) throw new Error('BETTER_AUTH_SECRET is not set.')

export const auth = betterAuth({
  secret,
  baseURL: authBaseURL(process.env),
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  plugins: [tanstackStartCookies()],
})
