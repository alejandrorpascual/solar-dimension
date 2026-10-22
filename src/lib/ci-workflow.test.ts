import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// The workflow is read as text, since a GitHub runner is the only thing that runs it: these hold what it must keep
// saying, so that a later edit cannot quietly undo the Node pin or leave a database behind.
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { engines?: { node?: string } }

/** Each step of the job as the text from its dash to the next step's. */
const steps = workflow.split(/\n(?=      - )/).slice(1)
const stepRunning = (command: string) => steps.findIndex((step) => step.includes(command))

test('package.json pins Node 24', () => {
  expect(packageJson.engines?.node).toBe('24.x')
})

test('setup-node reads the Node version from package.json and does not type one of its own', () => {
  expect(workflow).toMatch(/node-version-file:\s*package\.json/)
  expect(workflow).not.toMatch(/^\s*node-version:/m)
})

test('a step migrates an empty database, made for the run and not the test branch\'s own', () => {
  const make = stepRunning('fresh-database.ts create')

  expect(make, 'a step that makes the database').toBeGreaterThanOrEqual(0)
  expect(steps[make]).toMatch(/DATABASE_URL="\$fresh_url" npm run db:migrate/)
  expect(workflow).toMatch(/FRESH_DATABASE:\s*ci_fresh_\$\{\{ github\.run_id \}\}_\$\{\{ github\.run_attempt \}\}/)
})

test('the step right after the migration drops that database, also when it failed or the run was cancelled', () => {
  const make = stepRunning('fresh-database.ts create')
  const drop = stepRunning('fresh-database.ts drop')

  expect(drop, 'a step that drops the database').toBeGreaterThanOrEqual(0)
  // Not last: a run that uses up the job's timeout on the tests or the build would never reach it.
  expect(drop).toBe(make + 1)
  expect(steps[drop]).toMatch(/if:\s*\$\{\{ always\(\) \}\}/)
})

test('a hung migration or drop ends long before the job does, so the drop still runs', () => {
  const minutes = (step: string) => Number(/timeout-minutes:\s*(\d+)/.exec(step)?.[1])
  const job = minutes(workflow)
  const make = steps[stepRunning('fresh-database.ts create')]
  const drop = steps[stepRunning('fresh-database.ts drop')]

  expect(minutes(make) + minutes(drop)).toBeLessThan(job / 2)
})
