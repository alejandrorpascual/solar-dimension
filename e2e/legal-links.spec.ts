import { expect, test } from '@playwright/test'
import { PHONE } from './phone'

/** WCAG 2.2, success criterion 2.5.8 (Target Size, Minimum): a pointer target is at least this many CSS pixels each way. */
const MIN_TARGET_PX = 24

// The links sit under every step of the builder and on the sign-in page, in the same component.
for (const path of ['/', '/login']) {
  test(`${path}: the Privacy and Terms links each have a hit area at least ${MIN_TARGET_PX} px tall`, PHONE, async ({ page }) => {
    await page.goto(path)
    const links = page.getByRole('navigation', { name: 'Legal' }).getByRole('link')
    await expect(links).toHaveCount(2)
    const heights = await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    expect(heights.filter((height) => height < MIN_TARGET_PX), `link heights in px: ${heights.join(', ')}`).toEqual([])
  })
}
