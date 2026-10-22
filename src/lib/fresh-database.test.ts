import { expect, test } from 'vitest'
import { freshDatabase } from './fresh-database'

const NAME = 'ci_fresh_9876543210_2'
const URL_OF_TEST_BRANCH = 'postgresql://neondb_owner:not-a-real-password@ep-made-up-test-12345678-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

test('the database of a run is named for the run, and its URL differs from the test branch only in the database', () => {
  const fresh = freshDatabase(NAME, URL_OF_TEST_BRANCH)

  expect(fresh.name).toBe(NAME)
  expect(fresh.url).toBe(URL_OF_TEST_BRANCH.replace('/neondb?', `/${NAME}?`))
})

test('the URL keeps a port, an escaped password and a URL with no query as they were', () => {
  const fresh = freshDatabase(NAME, 'postgresql://user:p%40ss@localhost:5432/postgres')

  expect(fresh.url).toBe(`postgresql://user:p%40ss@localhost:5432/${NAME}`)
})

test('creates the database and drops it, by force, so a pooled connection that still holds it does not stop the drop', () => {
  const fresh = freshDatabase(NAME, URL_OF_TEST_BRANCH)

  expect(fresh.createSql).toBe(`CREATE DATABASE "${NAME}"`)
  expect(fresh.dropSql).toBe(`DROP DATABASE IF EXISTS "${NAME}" WITH (FORCE)`)
})

test.each([
  ['no name', undefined],
  ['an empty name', ''],
  ['the name of the test branch database itself', 'neondb'],
  ['a run id with no attempt', 'ci_fresh_9876543210'],
  ['a name with a letter in the run id', 'ci_fresh_abc_1'],
  ['a name that ends a statement and starts another', 'ci_fresh_1_1"; DROP DATABASE neondb; --'],
  ['a name with a line break after a valid one', 'ci_fresh_1_1\nneondb'],
])('refuses %s, so a mistyped name can never drop a database that is not a run\'s', (_case, name) => {
  expect(() => freshDatabase(name, URL_OF_TEST_BRANCH)).toThrow(/ci_fresh_<run id>_<attempt>/)
})

test('refuses a DATABASE_URL that is missing or is not a URL', () => {
  expect(() => freshDatabase(NAME, undefined)).toThrow(/DATABASE_URL/)
  expect(() => freshDatabase(NAME, 'not a url')).toThrow(/DATABASE_URL/)
})
