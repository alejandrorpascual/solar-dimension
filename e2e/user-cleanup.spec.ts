import { expect, test } from '@playwright/test'
import { cleanUpTestAccount, cleanupStatementsBehind, countQuoteRows, firstProjectId, holdUncommittedQuote } from './db'
import { signUpWithProject } from './quotes'

/** A fingerprint no listing of one account prints, short of a one-in-16^12 chance. */
const WRONG_FINGERPRINT = '000000000000'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'the cleanup runs in the database, so once is enough')
  // Sign-up and several statements over Neon can pass 30 s on a slow CI runner.
  test.slow()
})

test('the account cleanup deletes an account and its project only with the fingerprint of its listing', async ({ page }) => {
  const { email } = await signUpWithProject(page)

  expect(await cleanUpTestAccount(email, WRONG_FINGERPRINT)).toEqual({ users: 0, projects: 0 })
  await expect(firstProjectId(email)).resolves.toEqual(expect.any(String))

  expect(await cleanUpTestAccount(email)).toEqual({ users: 1, projects: 1 })
  await expect(firstProjectId(email)).rejects.toThrow(`no saved project for ${email}`)
})

test('the account cleanup deletes nothing when an upload commits a quote while it runs', async ({ page }) => {
  const { email, projectId } = await signUpWithProject(page)
  // The upload's quote is stored but not committed: the cleanup's own check for quotes cannot see it.
  const upload = await holdUncommittedQuote(email, projectId)
  let outcome: Promise<{ deleted: { users: number; projects: number } } | { refused: string }>
  try {
    outcome = cleanUpTestAccount(email).then((deleted) => ({ deleted }), (error: Error) => ({ refused: error.message }))
    // Deleting the project waits for the upload, whose quote points at it.
    await expect.poll(() => cleanupStatementsBehind(upload.pid), { timeout: 15_000 }).toBe(1)
  } finally {
    await upload.commit()
  }

  expect(await outcome).toEqual({ refused: expect.stringContaining('Nothing deleted') })
  // The account, its project and the quote are all still there: the quote's file would have had no row left to find it by.
  expect(await countQuoteRows(email, projectId)).toBe(1)
  // With the quote committed, the cleanup's own check sees it.
  expect(await cleanUpTestAccount(email)).toEqual({ users: 0, projects: 0 })
})
