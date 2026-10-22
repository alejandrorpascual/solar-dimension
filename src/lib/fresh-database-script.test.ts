import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { PRODUCTION_DB_ENDPOINT } from './db-endpoint'

// scripts/fresh-database.ts makes and drops the database of a CI run. It runs here as a process, as CI runs it, with a
// stand-in psql as the only thing on its PATH, so no database can be reached. The stand-in writes down each call and
// ends as told: a guard that let a run through shows as a call it wrote down.
const SCRIPT = resolve('scripts/fresh-database.ts')
const NAME = 'ci_fresh_9876543210_2'
const PASSWORD = 'not-a-real-password'
// `.invalid` never resolves: a URL that got past a guard would still reach nobody.
const urlOf = (host: string) => `postgresql://owner:${PASSWORD}@${host}.db.invalid/neondb?sslmode=require`
const TEST_BRANCH_URL = urlOf('ep-made-up-test-12345678-pooler')
const FRESH_URL = TEST_BRANCH_URL.replace('/neondb?', `/${NAME}?`)
const ENV = { DATABASE_URL: TEST_BRANCH_URL, FRESH_DATABASE: NAME }

const CALL_END = '@@end of call@@'
// Like psql, it prints the tag of its command on stdout and its errors on stderr.
const STAND_IN_PSQL = `#!/bin/sh
for arg in "$@"; do printf '%s\\n' "$arg" >> "$CALLS_FILE"; done
printf '%s\\n' '${CALL_END}' >> "$CALLS_FILE"
echo "COMMAND TAG"
if [ "$PSQL_EXIT" != 0 ]; then echo "psql: error: stand-in failed" >&2; fi
exit "$PSQL_EXIT"
`

const folders: string[] = []
afterAll(() => { for (const folder of folders) rmSync(folder, { recursive: true, force: true }) })

/** `psql` is how the stand-in ends: a number is its exit status, and 'absent' leaves no psql on the PATH at all. */
function runScript(args: string[], env: { DATABASE_URL?: string; FRESH_DATABASE?: string }, psql: number | 'absent' = 0) {
  const folder = mkdtempSync(join(tmpdir(), 'fresh-database-'))
  folders.push(folder)
  const callsFile = join(folder, 'calls')
  if (psql !== 'absent') {
    writeFileSync(join(folder, 'psql'), STAND_IN_PSQL)
    chmodSync(join(folder, 'psql'), 0o755)
  }
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: folder,
    env: { PATH: folder, CALLS_FILE: callsFile, PSQL_EXIT: String(psql === 'absent' ? 0 : psql), ...env },
    encoding: 'utf8',
  })
  // The arguments of each psql call the stand-in got.
  const calls = !existsSync(callsFile) ? [] : readFileSync(callsFile, 'utf8').split(`${CALL_END}\n`).filter(Boolean)
    .map((call) => call.split('\n').filter(Boolean))
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, calls }
}

test('create makes the database of the run on the test branch and prints its URL, and nothing else, on stdout', () => {
  const run = runScript(['create'], ENV)

  expect(run.status).toBe(0)
  // A step takes stdout for the URL to migrate: the command tag psql prints must not be in it.
  expect(run.stdout).toBe(`${FRESH_URL}\n`)
  expect(run.stderr).toContain(`made database ${NAME}`)
  expect(run.stderr).not.toContain(PASSWORD)
  expect(run.calls).toHaveLength(1)
  expect(run.calls[0]).toContain(TEST_BRANCH_URL)
  expect(run.calls[0]).toContain(`CREATE DATABASE "${NAME}"`)
})

test('drop runs from the test branch\'s own database, since a database cannot be dropped from inside it, and prints no URL', () => {
  const run = runScript(['drop'], ENV)

  expect(run.status).toBe(0)
  expect(run.stdout).toBe('')
  expect(run.stderr).toContain(`dropped database ${NAME}`)
  expect(run.calls).toHaveLength(1)
  expect(run.calls[0]).toContain(TEST_BRANCH_URL)
  expect(run.calls[0]).not.toContain(FRESH_URL)
  expect(run.calls[0]).toContain(`DROP DATABASE IF EXISTS "${NAME}" WITH (FORCE)`)
  expect(run.calls[0].some((arg) => arg.includes('CREATE'))).toBe(false)
})

const NOT_A_RUN = 'ci_fresh_<run id>_<attempt>'
const NOT_A_COMMAND = 'the command is one of create or drop'
test.each([
  ['create on the production database', ['create'], { ...ENV, DATABASE_URL: urlOf(`${PRODUCTION_DB_ENDPOINT}-pooler`) }, 'the production database'],
  ['drop on the production database', ['drop'], { ...ENV, DATABASE_URL: urlOf(`${PRODUCTION_DB_ENDPOINT}-pooler`) }, 'the production database'],
  ['create with no name for the database', ['create'], { DATABASE_URL: TEST_BRANCH_URL }, NOT_A_RUN],
  ['drop with no name for the database', ['drop'], { DATABASE_URL: TEST_BRANCH_URL }, NOT_A_RUN],
  ['drop of the test branch\'s own database', ['drop'], { ...ENV, FRESH_DATABASE: 'neondb' }, NOT_A_RUN],
  ['no command', [], ENV, NOT_A_COMMAND],
  ['a command it does not know', ['reset'], ENV, NOT_A_COMMAND],
])('refuses %s before it starts psql', (_case, args, env, message) => {
  const run = runScript(args, env)

  expect(run.status).toBe(1)
  expect(run.stderr).toContain(message)
  expect(run.stderr).not.toContain(PASSWORD)
  expect(run.stdout).toBe('')
  expect(run.calls).toEqual([])
})

test.each(['create', 'drop'])('%s fails the step, prints no URL and shows what psql said, when psql fails', (command) => {
  const run = runScript([command], ENV, 2)

  expect(run.status).toBe(1)
  expect(run.stdout).toBe('')
  expect(run.stderr).toContain('psql: error: stand-in failed')
  expect(run.stderr).toContain(`fresh-database ${command} failed: psql ended with 2.`)
})

test('fails the step, and says why, when there is no psql to start', () => {
  const run = runScript(['drop'], ENV, 'absent')

  expect(run.status).toBe(1)
  expect(run.stderr).toContain('fresh-database drop failed: could not start psql')
})
