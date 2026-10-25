import { expect, test, type Locator, type Page } from '@playwright/test'
import { PHONE } from './phone'
import { openVerdictFromTray, quotePdf, signUp, uploadQuotes } from './quotes'

// Issue #192: the hand-off dialog and the must-haves sheet faded in but vanished in one frame when closed. Each must
// play a short exit, at 1440 px and as the 390 px sheet, and with Reduce Motion on, close with none.

/** The issue's limit for an exit; the kit sheet's own is 160 ms. */
const MAX_EXIT_MS = 160
const WIDE = { width: 1440, height: 900 }

/** One moment of an exit: the overlay's opacity, and the dialog's opacity and downward shift in px. */
interface Frame { overlayOpacity: number; dialogOpacity: number; dialogShift: number }
/** How long, in ms, each part of a dialog animated as it closed, and how it looked early, midway and at the end. */
interface Exits { overlay: number[]; dialog: number[]; frames: Frame[] }
type Recorded = Window & { dialogExits?: Exits }

/** The exit moments sampled, in ms; the last frame is 1 ms before the longest part ends. */
const EARLY_MS = 10
const MIDWAY_MS = 70

/**
 * Starts writing down what the page animates on a dialog's overlay and on the dialog itself. React Aria keeps a
 * closing dialog on the page, marked data-exiting, only for as long as its exit runs, so the animations are read
 * the moment the mark appears: a test looking after the click would find the dialog already gone, or still there,
 * by chance. Without an exit animation the dialog is removed at once and nothing is written down. With one, the
 * exit is paused, seeked to a few moments to read how it looks, and played on from where it was.
 */
async function recordExits(page: Page, moments: { early: number; midway: number }): Promise<void> {
  await page.evaluate(({ early, midway }) => {
    const exits: Exits = { overlay: [], dialog: [], frames: [] }
    ;(window as Recorded).dialogExits = exits
    const endOf = (a: Animation) => Number(a.effect?.getComputedTiming().endTime)
    const frameAt = (overlay: Element, dialog: Element, animations: Animation[], ms: number): Frame => {
      for (const a of animations) a.currentTime = ms
      const look = getComputedStyle(dialog)
      return {
        overlayOpacity: Number(getComputedStyle(overlay).opacity),
        dialogOpacity: Number(look.opacity),
        dialogShift: new DOMMatrixReadOnly(look.transform === 'none' ? undefined : look.transform).m42,
      }
    }
    new MutationObserver(() => {
      if (exits.overlay.length || exits.dialog.length) return
      const overlay = document.querySelector('.qdialog__overlay[data-exiting]')
      const dialog = overlay?.querySelector('.qdialog[data-exiting]')
      if (!overlay || !dialog) return
      const animations = [...overlay.getAnimations(), ...dialog.getAnimations()]
      exits.overlay.push(...overlay.getAnimations().map(endOf))
      exits.dialog.push(...dialog.getAnimations().map(endOf))
      if (!animations.length) return
      const started = animations.map((a) => a.currentTime)
      for (const a of animations) a.pause()
      const last = Math.max(...animations.map(endOf)) - 1
      exits.frames.push(...[early, midway, last].map((ms) => frameAt(overlay, dialog, animations, ms)))
      animations.forEach((a, i) => { a.currentTime = started[i]; a.play() })
    }).observe(document.body, { attributes: true, attributeFilter: ['data-exiting'], subtree: true })
  }, moments)
}

const readExits = (page: Page): Promise<Exits> => page.evaluate(() => (window as Recorded).dialogExits ?? { overlay: [], dialog: [], frames: [] })

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
    await recordExits(page, { early: EARLY_MS, midway: MIDWAY_MS })

    await close.click()
    await expect(dialog).toHaveCount(0)

    const exits = await readExits(page)
    for (const part of ['overlay', 'dialog'] as const) {
      expect(exits[part], `the ${part} animates as it closes`).not.toHaveLength(0)
      expect(Math.min(...exits[part]), `the ${part}'s exit lasts a moment`).toBeGreaterThan(0)
      expect(Math.max(...exits[part]), `the ${part}'s exit is short (ms)`).toBeLessThanOrEqual(MAX_EXIT_MS)
    }

    // An exit, not the entrance played again: everything fades and the dialog moves down as it goes, and the
    // overlay stays faded until the slower part is done rather than flashing back.
    const [early, midway, last] = exits.frames
    expect(midway.overlayOpacity, 'the overlay fades out').toBeLessThan(early.overlayOpacity)
    expect(midway.dialogOpacity, 'the dialog fades out').toBeLessThanOrEqual(early.dialogOpacity)
    expect(midway.dialogShift, 'the dialog moves down (px)').toBeGreaterThan(early.dialogShift)
    expect(last.overlayOpacity, 'the overlay is still faded as the exit ends').toBeLessThan(0.1)
  })

  test(`with Reduce Motion on, the ${name} closes with no animation`, PHONE, async ({ page }, info) => {
    if (info.project.name === 'desktop') await page.setViewportSize(WIDE)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { dialog, close } = await open(page)
    await recordExits(page, { early: EARLY_MS, midway: MIDWAY_MS })

    await close.click()
    await expect(dialog).toHaveCount(0)

    expect(await readExits(page)).toEqual({ overlay: [], dialog: [], frames: [] })
  })
}
