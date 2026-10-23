import { expect, test, type Locator, type Page } from '@playwright/test'
import { PHONE } from './phone'
import { isJobsRead, signUp, slowQuotePdf, tray, uploadQuotes } from './quotes'

// Issue #144: a read takes 30 s to a minute, and the reading screens looked frozen for all of it. Each one must change
// while a quote is read, with Reduce Motion on or off, and with Reduce Motion on nothing on the page may animate.

/** The issue's measure is two frames 2 s apart; a little more, so a once-a-second change always falls between them. */
const FRAME_GAP_MS = 2_100
/** How often the page is checked for running animations between the two frames. */
const SAMPLE_MS = 300
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 390, height: 800 }
const SLOW_QUOTE = 'voltia'

/**
 * Holds the page's polls of the quote jobs until the returned function lets them through. The stub reads a slow quote
 * in 3 s, too short to look at a screen twice mid-read; while the polls are held, the page goes on showing the read as
 * under way, as it would through a real 30 s read.
 */
async function holdJobPolls(page: Page): Promise<() => void> {
  let letThrough = () => {}
  const held = new Promise<void>((resolve) => { letThrough = resolve })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'GET' && isJobsRead(route.request().url())) await held
    await route.continue()
  })
  return letThrough
}

/** Signs up, uploads a quote the stub takes its time over, and holds the polls that would learn its read has ended. */
async function startSlowRead(page: Page): Promise<() => void> {
  await signUp(page)
  await uploadQuotes(page, [await slowQuotePdf(SLOW_QUOTE)])
  return holdJobPolls(page)
}

/** What is animating on the page right now, CSS animations and transitions alike, named by the element's class. */
const runningAnimations = (page: Page): Promise<string[]> =>
  page.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === 'running')
    .map((a) => {
      const target = a.effect instanceof KeyframeEffect ? a.effect.target : null
      return target?.getAttribute('class') ?? 'an element without a class'
    }))

/** Whether `part` looks different FRAME_GAP_MS after a first look at it. */
async function changesWithinTheGap(page: Page, part: Locator): Promise<boolean> {
  const first = await part.screenshot()
  await page.waitForTimeout(FRAME_GAP_MS)
  return !first.equals(await part.screenshot())
}

/**
 * `part` looks different FRAME_GAP_MS later while nothing on the page animates: with Reduce Motion on its spinner
 * stands still, so the change must come from something that does not move.
 */
async function expectChangeWithoutMotion(page: Page, part: Locator, name: string): Promise<void> {
  await expect(part).toBeVisible()
  const first = await part.screenshot()
  const end = Date.now() + FRAME_GAP_MS
  while (Date.now() < end) {
    expect(await runningAnimations(page), `what animates while ${name} shows`).toEqual([])
    await page.waitForTimeout(SAMPLE_MS)
  }
  expect(first.equals(await part.screenshot()), `${name}: two frames ${FRAME_GAP_MS} ms apart are the same`).toBe(false)
}

test('mid-read, the tray changes within 2 s at 1440 and 390 px, and the quotes card shows a spinner, not the file icon', async ({ page }) => {
  await page.setViewportSize(WIDE)
  const letPollsThrough = await startSlowRead(page)
  await page.getByRole('button', { name: 'Ok, got it' }).click()

  const cardIcon = page.locator('.qcard__icon')
  await expect(cardIcon.locator('svg.qspin')).toBeVisible()
  await expect(cardIcon.locator('.lucide-file-text')).toHaveCount(0)
  await expect(tray(page).locator('svg.qspin')).toBeVisible()
  // With motion allowed, the page's own animation list holds the turning spinners: the Reduce Motion test's empty list
  // is a real check, not one that could never see them.
  expect(await runningAnimations(page)).toContain('qspin')

  for (const size of [WIDE, NARROW]) {
    await page.setViewportSize(size)
    expect(await changesWithinTheGap(page, tray(page)), `the tray at ${size.width} px`).toBe(true)
  }

  letPollsThrough()
  await expect(tray(page).getByRole('link', { name: 'See verdict' })).toBeVisible({ timeout: 30_000 })
  await expect(cardIcon.locator('.lucide-file-text')).toBeVisible()
  await expect(cardIcon.locator('svg.qspin')).toHaveCount(0)
})

test('with Reduce Motion on, the upload dialog and the tray each change within 2 s while nothing animates', PHONE, async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize(WIDE)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startSlowRead(page)

  const dialog = page.getByRole('dialog', { name: "We've got it from here" })
  await expectChangeWithoutMotion(page, dialog.getByRole('listitem').filter({ hasText: SLOW_QUOTE }), 'the upload dialog row')

  await dialog.getByRole('button', { name: 'Ok, got it' }).click()
  await expect(dialog).toHaveCount(0)
  await expectChangeWithoutMotion(page, tray(page), 'the tray')
})

test('with Reduce Motion on, Watch progress changes within 2 s while nothing animates', PHONE, async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize(WIDE)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startSlowRead(page)

  // Straight away, while the server still reads the quote, so the page opens on it being read.
  await page.getByRole('dialog').getByRole('link', { name: 'Watch progress' }).click()
  const card = page.getByRole('article').filter({ hasText: SLOW_QUOTE })
  await expect(card.getByText(/^Ready in about 30 s · \d+:\d{2} so far$/)).toBeVisible()
  await expectChangeWithoutMotion(page, card, 'the Watch progress card')
})
