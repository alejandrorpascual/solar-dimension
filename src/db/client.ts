import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { databaseTarget, TEST_DB_ENDPOINT_ENV } from '../lib/db-endpoint'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local` or set it in the environment.')

export const db = drizzle({ client: neon(url), schema })
/** The database `db` writes to, read from the URL it was built with. Safe to show: an id, never the URL. */
export const dbTarget = databaseTarget(url, process.env[TEST_DB_ENDPOINT_ENV])
export type Db = typeof db
