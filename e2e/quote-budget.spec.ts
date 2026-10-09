import { expect, test } from '@playwright/test'
import {
  countQuoteRows, dailyReads, firstProjectId, holdQuoteRow, quoteRetryCount, quoteRetryStates, raiseDailyReadsTo, seedFailedQuote, seedQuoteRows,
  waitingRetryStatements,
} from './db'
import { captureRetryCall, postRetry, quotePdf, signUp, uploadQuotes } from './quotes'
import { BUDGET_DAILY_READS, BUDGET_PORT } from './servers'

/** The server whose daily read budget is 1 (playwright.config.ts). It shares the build, the database and the session. */
const BUDGET_SERVER = `http://localhost:${BUDGET_PORT}`
const PAUSED = 'Quote reading is paused for today. Try again tomorrow.'

/** Signs up, waits for the default project to reach the server, and returns its id. */
async function signUpWithProject(page: Parameters<typeof signUp>[0]): Promise<{ email: string; projectId: string }> {
  const email = await signUp(page)
  await page.goto('/?step=4')
  await expect(page.getByRole('button', { name: 'Upload quotes' })).toBeEnabled({ timeout: 15_000 })
  return { email, projectId: await firstProjectId(email) }
}

test('an admitted upload takes one of the day’s reads', async ({ page }) => {
  // Sign-up, an upload and database reads over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  const before = await dailyReads()
  await uploadQuotes(page, [await quotePdf('solartec')])
  await expect(page.getByRole('dialog', { name: "We've got it from here" })).toBeVisible()
  await expect.poll(() => countQuoteRows(email, projectId)).toBe(1)
  // Other tests share the counter, so it can only be said to have grown.
  expect(await dailyReads()).toBeGreaterThan(before)
})

test('with the day’s reads spent, an upload is refused with the reason and nothing is stored', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up, which can pass 30 s on a slow CI runner.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  await raiseDailyReadsTo(BUDGET_DAILY_READS)

  await uploadQuotes(page, [await quotePdf('solartec')], 'Upload quotes', BUDGET_SERVER)
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'solartec.pdf' })).toContainText(PAUSED)
  expect(await countQuoteRows(email, projectId)).toBe(0)
})

test('with the day’s reads spent, a retry is refused with the reason and the quote stays as it was', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up, which can pass 30 s on a slow CI runner.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  await seedQuoteRows(email, projectId, 1)
  await raiseDailyReadsTo(BUDGET_DAILY_READS)

  await page.goto(`${BUDGET_SERVER}/projects/${projectId}/quotes`)
  const row = page.getByRole('article').filter({ hasText: 'seed-1.pdf' })
  await row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(row.getByRole('alert')).toHaveText(PAUSED)
  expect(await quoteRetryStates(email, projectId)).toEqual([{ status: 'failed', retries: 0 }])
})

/** Other tests take reads at any moment, so a run can see more than one; any run that sees exactly one proves the point. */
const RACE_TRIALS = 5

test('two retries of the same quote at once take one read and re-queue it once', async ({ page }) => {
  // Several seeded races over Neon, each waiting for both statements to queue on a row lock: well past 30 s on CI.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  const probe = await seedFailedQuote(email, projectId, 'probe.pdf')
  await page.goto(`/projects/${projectId}/quotes`)
  const captured = captureRetryCall(page, probe)
  await page.getByRole('article').filter({ hasText: 'probe.pdf' }).getByRole('button', { name: 'Retry', exact: true }).click()
  const call = await captured

  // Each run holds a lock on a fresh failed quote while two retries of it arrive, so both statements are in flight at
  // once, then lets them go. Without a lock on the quote in the retry, both take a read: a run never sees just one.
  const reads: number[] = []
  for (let run = 0; run < RACE_TRIALS && !reads.includes(1); run++) {
    const id = await seedFailedQuote(email, projectId, `race-${run}.pdf`)
    const lock = await holdQuoteRow(id)
    const before = await dailyReads()
    let answers: Promise<string[]>
    try {
      answers = Promise.all([postRetry(page, call, probe, id), postRetry(page, call, probe, id)].map(async (r) => (await r).text()))
      await expect.poll(waitingRetryStatements, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    } finally {
      await lock.release()
    }
    const bodies = await answers
    reads.push((await dailyReads()) - before)
    // One call re-queued the quote; the other found nothing left to retry.
    expect(bodies.filter((b) => !b.includes('$TSR/Error'))).toHaveLength(1)
    expect(await quoteRetryCount(id)).toBe(1)
  }
  expect(reads).toContain(1)
})
