import { expect, test, type Page } from '@playwright/test'
import {
  countQuoteRows, dailyReads, holdQuoteRow, quoteRetryCount, quoteRetryStates, raiseDailyReadsTo, retryStatementsBehind, seedFailedQuote,
  seedQuoteRows, takeTurn,
} from './db'
import { captureRetryCall, postRetry, quotePdf, signUpWithProject, uploadQuotes, type CapturedCall } from './quotes'
import { BUDGET_DAILY_READS, BUDGET_PORT } from './servers'

/** The server whose daily read budget is 1 (playwright.config.ts). It shares the build, the database and the session. */
const BUDGET_SERVER = `http://localhost:${BUDGET_PORT}`
const PAUSED = 'Quote reading is paused for today. Try again tomorrow.'

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

/**
 * The day's counter is shared, so a read this race did not take (an upload or a retry in another test) can land
 * between its two readings of the counter. Any run that sees exactly one read proves the point.
 */
const RACE_TRIALS = 5
/**
 * Every copy of the race waits for this turn. Without it two copies started together (another checkout, or CI, on this
 * database) stay in step: each takes its one read between the other's two readings, in every run, and both see two.
 */
const RACE_TURN = 'quote-retry-race'

/**
 * One race: holds a lock on a failed quote while two retries of it arrive, so both statements are in flight at once,
 * then lets them go. Returns the two answers and how far the day's counter moved from then on.
 */
async function raceTwoRetries(page: Page, call: CapturedCall, probe: string, id: string): Promise<{ bodies: string[]; reads: number }> {
  const lock = await holdQuoteRow(id)
  let answers: Promise<string[]>
  let before: number
  try {
    answers = Promise.all([postRetry(page, call, probe, id), postRetry(page, call, probe, id)].map(async (r) => (await r).text()))
    // Only retries waiting behind this quote's lock count. Another copy's two would let this lock go too early.
    await expect.poll(() => retryStatementsBehind(lock.pid), { timeout: 15_000 }).toBe(2)
    // Neither waiting statement has committed a read yet, with or without the retry's own lock on the quote: each is
    // one transaction, and it ends after this lock goes.
    before = await dailyReads()
  } finally {
    await lock.release()
  }
  const bodies = await answers
  return { bodies, reads: (await dailyReads()) - before }
}

test('two retries of the same quote at once take one read and re-queue it once', async ({ page }) => {
  // Several seeded races over Neon, each waiting for both statements to queue on a row lock, after a wait for the
  // turn (up to 30 s when a copy has stalled): well past 30 s.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  const probe = await seedFailedQuote(email, projectId, 'probe.pdf')
  await page.goto(`/projects/${projectId}/quotes`)
  const captured = captureRetryCall(page, probe)
  await page.getByRole('article').filter({ hasText: 'probe.pdf' }).getByRole('button', { name: 'Retry', exact: true }).click()
  const call = await captured

  // Without a lock on the quote in the retry, both statements take a read: a run never sees just one.
  const reads: number[] = []
  const turn = await takeTurn(RACE_TURN)
  try {
    for (let run = 0; run < RACE_TRIALS && !reads.includes(1); run++) {
      const id = await seedFailedQuote(email, projectId, `race-${run}.pdf`)
      const race = await raceTwoRetries(page, call, probe, id)
      reads.push(race.reads)
      // One call re-queued the quote; the other found nothing left to retry.
      expect(race.bodies.filter((b) => !b.includes('$TSR/Error'))).toHaveLength(1)
      expect(await quoteRetryCount(id)).toBe(1)
    }
  } finally {
    await turn.release()
  }
  expect(reads).toContain(1)
})
