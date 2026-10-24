import { expect, test, type Locator, type Page } from '@playwright/test'
import { PHONE } from './phone'
import { openVerdictFromTray, quotePdf, signUp, uploadQuotes } from './quotes'

// Issue #192: the hand-off dialog and the must-haves sheet faded in but vanished in one frame when closed. Each must
// play a short exit, at 1440 px and as the 390 px sheet, and with Reduce Motion on, close with none.

/** The issue's limit for an exit; the kit sheet's own is 160 ms. */
const MAX_EXIT_MS = 160
const WIDE = { width: 1440, height: 900 }

/** How long, in ms, each part of a dialog animated as it closed. */
interface Exits { overlay: number[]; dialog: number[] }
type Recorded = Window & { dialogExits?: Exits }

/**
 * Starts writing down what the page animates on a dialog's overlay and on the dialog itself. React Aria keeps a
 * closing dialog on the page, marked data-exiting, only for as long as its exit runs, so the animations are read
 * the moment the mark appears: a test looking after the click would find the dialog already gone, or still there,
 * by chance. Without an exit animation the dialog is removed at once and nothing is written down.
 */
async function recordExits(page: Page): Promise<void> {
  await page.evaluate(() => {
    const exits: Exits = { overlay: [], dialog: [] }
    ;(window as Recorded).dialogExits = exits
    const lengthsOf = (element: Element) => element.getAnimations().map((a) => Number(a.effect?.getComputedTiming().endTime))
    new MutationObserver((changes) => {
      for (const { target } of changes) {
        if (!(target instanceof Element)) continue
        if (target.matches('.qdialog__overlay')) exits.overlay.push(...lengthsOf(target))
        if (target.matches('.qdialog')) exits.dialog.push(...lengthsOf(target))
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['data-exiting'], subtree: true })
  })
}

const readExits = (page: Page): Promise<Exits> => page.evaluate(() => (window as Recorded).dialogExits ?? { overlay: [], dialog: [] })

/** The hand-off dialog, which opens by itself once quotes are picked, and the button that closes it. */
async function openHandoff(page: Page): Promise<{ dialog: Locator; close: Locator }> {
  await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  const dialog = page.getByRole('dialog', { name: "We've got it from here" })
  await expect(dialog).toBeVisible()
  return { dialog, close: dialog.getByRole('button', { name: 'Ok, got it' }) }
}

/** The must-haves sheet, opened from the verdict of one quote, and the button that closes it. */
async function openMusts(page: Page): Promise<{ dialog: Locator; close: Locator }> {
  const handoff = await openHandoff(page)
  await handoff.close.click()
  await openVerdictFromTray(page)
  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'What matters for this project' })
  await expect(dialog).toBeVisible()
  return { dialog, close: dialog.getByRole('button', { name: 'Done', exact: true }) }
}

const DIALOGS = [
  { name: 'hand-off dialog', open: openHandoff },
  { name: 'must-haves sheet', open: openMusts },
]

for (const { name, open } of DIALOGS) {
  test(`the ${name} plays a short exit when it closes, as a dialog and as a phone sheet`, PHONE, async ({ page }, info) => {
    if (info.project.name === 'desktop') await page.setViewportSize(WIDE)
    const { dialog, close } = await open(page)
    await recordExits(page)

    await close.click()
    await expect(dialog).toHaveCount(0)

    const exits = await readExits(page)
    for (const part of ['overlay', 'dialog'] as const) {
      expect(exits[part], `the ${part} animates as it closes`).not.toHaveLength(0)
      expect(Math.min(...exits[part]), `the ${part}'s exit lasts a moment`).toBeGreaterThan(0)
      expect(Math.max(...exits[part]), `the ${part}'s exit is short (ms)`).toBeLessThanOrEqual(MAX_EXIT_MS)
    }
  })

  test(`with Reduce Motion on, the ${name} closes with no animation`, PHONE, async ({ page }, info) => {
    if (info.project.name === 'desktop') await page.setViewportSize(WIDE)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { dialog, close } = await open(page)
    await recordExits(page)

    await close.click()
    await expect(dialog).toHaveCount(0)

    expect(await readExits(page)).toEqual({ overlay: [], dialog: [] })
  })
}
