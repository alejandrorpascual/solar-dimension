// `npm run db:migrate`: applies drizzle/ migrations with drizzle-kit, but only to a database migrationPlan() allows.
// The Vercel build and CI both run it. It exits 1 without starting drizzle-kit when the database is refused, and 0
// without starting it when a Preview build was given the production database, so that build goes on.
import { spawnSync } from 'node:child_process'
import { config as loadEnv } from 'dotenv'
import { migrationPlan } from '../src/lib/migration-guard.ts'

// Read before the env file is, so the file that holds the production URL cannot also say this is the production
// build. Whatever started this process still can: VERCEL_ENV is taken as given, the way Vercel sets it for a build.
const buildEnv = process.env.VERCEL_ENV
// As drizzle.config.ts does, and never over a variable that is already set: the plan is made for the URL drizzle-kit
// will use.
loadEnv({ path: '.env.local', quiet: true })

const plan = migrationPlan({ DATABASE_URL: process.env.DATABASE_URL, VERCEL_ENV: buildEnv })
if (plan.action === 'refuse') {
  console.error(`db:migrate refused: ${plan.reason}`)
  process.exit(1)
}
if (plan.action === 'skip') {
  console.warn(`db:migrate skipped: ${plan.reason}`)
  process.exit(0)
}

console.log(`db:migrate: migrating ${plan.endpoint}`)
const run = spawnSync(process.execPath, ['node_modules/drizzle-kit/bin.cjs', 'migrate'], { stdio: 'inherit' })
if (run.error) console.error(`db:migrate could not start drizzle-kit: ${run.error.message}`)
process.exit(run.status ?? 1)
