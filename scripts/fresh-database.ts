// CI only: an empty database for one run, so its migrations are run from nothing and not on top of the ones the test
// branch already has. DATABASE_URL is the test branch's; FRESH_DATABASE names the run's database
// (src/lib/fresh-database.ts).
//
//   node scripts/fresh-database.ts create   makes it, and prints the URL to migrate it with, which holds the password
//   node scripts/fresh-database.ts drop     drops it if it is there, whether or not an earlier step made it or failed
//
// Both refuse the production database first, as the workflow's first step does: the drop step runs even after that
// step has failed.
import { spawnSync } from 'node:child_process'
import { assertTestDatabase } from '../e2e/test-env.ts'
import { freshDatabase } from '../src/lib/fresh-database.ts'

const COMMANDS = ['create', 'drop']
const command = process.argv[2]
const isCreate = command === 'create'

function fail(message: string): never {
  console.error(`fresh-database ${command ?? ''} failed: ${message}`)
  process.exit(1)
}

if (!COMMANDS.includes(command)) fail(`the command is one of ${COMMANDS.join(' or ')}.`)

try {
  // Empty when missing, which assertTestDatabase refuses with its own message.
  const testBranchUrl = process.env.DATABASE_URL ?? ''
  assertTestDatabase(testBranchUrl)
  const fresh = freshDatabase(process.env.FRESH_DATABASE, testBranchUrl)

  // psql is on the runner. Its stdout, the command's tag, is left out: a step takes this script's output for the URL.
  const run = spawnSync(
    'psql',
    [testBranchUrl, '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '--command', isCreate ? fresh.createSql : fresh.dropSql],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  if (run.error) fail(`could not start psql: ${run.error.message}`)
  if (run.status !== 0) fail(`psql ended with ${run.status ?? run.signal}.`)

  console.error(`${isCreate ? 'made' : 'dropped'} database ${fresh.name}`)
  if (isCreate) console.log(fresh.url)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
