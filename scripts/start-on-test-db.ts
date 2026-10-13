// Starts the built app (.output) on the e2e database only, to look at it in a browser or trial a catalog skill.
// `npm run start` reads .env.local, which points at production, and a DATABASE_URL exported in the shell beats any
// `node --env-file`; this goes through e2e's guard, which puts .env.test.local first and throws for production or
// for .env.local's database before the server is loaded. The guard also vouches for the database it let through,
// which is why a server started this way answers GET /api/catalog/database with "test".
//
//   npm run build && node scripts/start-on-test-db.ts
import { loadTestEnv } from '../e2e/test-env.ts'

console.log(`starting on ${loadTestEnv()}`)
// @ts-expect-error The build output has no types, and before a build it is not there at all: an error either way.
await import('../.output/server/index.mjs')
