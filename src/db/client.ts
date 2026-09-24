import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local` or set it in the environment.')

export const db = drizzle({ client: neon(url), schema })
export type Db = typeof db
