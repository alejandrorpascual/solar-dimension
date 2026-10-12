// Starts the built app (.output) on the e2e database only, to look at it in a browser or trial a catalog skill.
// `npm run start` reads .env.local, which points at production, and a DATABASE_URL exported in the shell beats any
// `node --env-file`; this goes through e2e's guard, which puts .env.test.local first and throws for production or
// for .env.local's database before the server is loaded.
//
//   npm run build && node scripts/start-on-test-db.ts
import { loadTestEnv } from '../e2e/test-env.ts'
import { endpointOf } from '../src/lib/db-endpoint.ts'

loadTestEnv()
console.log(`starting on ${endpointOf(process.env.DATABASE_URL)}`)
await import('../.output/server/index.mjs')
