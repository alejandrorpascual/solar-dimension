// Applies drizzle/ migrations to the e2e database only. `npm run db:migrate` reads .env.local, which points at
// production; this reads .env.test.local through e2e's guard, which throws for production or for .env.local's database.
//
//   npx tsx scripts/migrate-test-db.ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'
import { endpointOf, loadTestEnv } from '../e2e/test-env'

loadTestEnv()
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set after loadTestEnv()')
await migrate(drizzle({ client: neon(url) }), { migrationsFolder: './drizzle' })
console.log(`migrated ${endpointOf(url)}`)
