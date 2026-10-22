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

test('the last step drops that database, and runs when an earlier step failed or the run was cancelled', () => {
  const drop = stepRunning('fresh-database.ts drop')

  expect(drop, 'a step that drops the database').toBeGreaterThanOrEqual(0)
  expect(drop).toBe(steps.length - 1)
  expect(steps[drop]).toMatch(/if:\s*\$\{\{ always\(\) \}\}/)
})
