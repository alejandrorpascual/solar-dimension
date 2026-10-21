import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { switchLanguage } from './header'
import { PHONE } from './phone'
import { showDownload } from './projects'

async function downloadAs(page: Page, format: RegExp, button: string): Promise<Download> {
  await page.getByRole('radio', { name: format }).check()
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
  return file
}

/** A downloaded CSV's lines, without the BOM. */
async function csvLines(file: Download): Promise<string[]> {
  return (await readFile((await file.path())!, 'utf8')).replace(/^﻿/, '').split('\r\n')
}

/** The date the sheet preview prints above the project's name: the CSV's date row repeats it. */
const sheetDate = async (page: Page) => (await page.locator('.ksheet').filter({ visible: true }).locator('.ksheet__kicker span').nth(1).textContent()) ?? ''

test.describe('on a device set to Spanish (Venezuela), where decimals take a comma', () => {
  test.use({ locale: 'es-VE' })

  test('the CSV splits cells on ";" and opens with the project rows, in the page language whichever it is', async ({ page }) => {
    await page.goto('/?step=4')
    await expect(page.getByRole('heading', { name: 'Kit para Casa' })).toBeVisible()
    await showDownload(page, 'Descargar')
    const fecha = await sheetDate(page)
    const spanish = await csvLines(await downloadAs(page, /^Lista de partes \(CSV\)/, 'Descargar CSV'))
    expect(spanish.slice(0, 6)).toEqual([
      'Nombre del proyecto;Casa', `Fecha;${fecha}`, 'Horas sin red eléctrica;10 h', 'Voltaje del banco;48 V', '',
      'Aparato;Tipo;Cantidad;C/u (W);En marcha (W);Promedio (W);Wh en 10 h',
    ])
    expect(spanish).toContain('Refrigerador;Encienden y apagan;1;150;150;53;525')

    // The separator follows the device, not the page: in English the file still splits on ";", so the comma in the TV's
    // name and in the date stays inside its cell, unquoted. The first project, never edited, is named in English now.
    await switchLanguage(page, 'English')
    await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
    const date = await sheetDate(page)
    expect(date).toContain(',')
    const english = await csvLines(await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV'))
    expect(english.slice(0, 6)).toEqual([
      'Project name;Home', `Date;${date}`, 'Hours without the grid;10 h', 'Battery voltage;48 V', '',
      'Appliance;Kind;Quantity;Each (W);Running (W);Average (W);Wh over 10 h',
    ])
    expect(english).toContain('TV, 55-inch LED;Always on;1;120;120;120;1200')
  })
})

test.describe('on a device set to English (US)', () => {
  test.use({ locale: 'en-US' })

  test('the CSV splits cells on ",", quotes a cell holding a comma, and opens with the project rows', async ({ page }) => {
    await page.goto('/?step=4')
    await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
    await showDownload(page)
    const date = await sheetDate(page)
    expect(date).toContain(',')
    const lines = await csvLines(await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV'))
    expect(lines.slice(0, 6)).toEqual([
      'Project name,Home', `Date,"${date}"`, 'Hours without the grid,10 h', 'Battery voltage,48 V', '',
      'Appliance,Kind,Quantity,Each (W),Running (W),Average (W),Wh over 10 h',
    ])
    expect(lines).toContain('"TV, 55-inch LED",Always on,1,120,120,120,1200')
  })
})

test('the kit downloads as a CSV parts list and a PDF spec sheet', PHONE, async ({ page }) => {
  await page.goto('/?step=4')
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await showDownload(page)

  const csv = await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV')
  expect(csv.suggestedFilename()).toBe('Home-kit.csv')
  await expect(page.getByRole('status').filter({ hasText: 'File ready. Download started.' })).toBeVisible()
  const text = await readFile((await csv.path())!, 'utf8')
  expect(text).toContain('Appliance,Kind,Quantity,Each (W),Running (W),Average (W),Wh over 10 h')
  expect(text).toContain('Refrigerator,Cycles on and off,1,150,150,53,')
  expect(text).toContain('Part,Specification,Note,Quantity')
  expect(text).not.toContain('Interconnects')

  await expect(page.getByRole('checkbox', { name: 'Summary figures' })).toBeDisabled()
  await page.getByRole('checkbox', { name: 'Appliance list' }).uncheck()
  const partsOnly = await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV')
  expect(await readFile((await partsOnly.path())!, 'utf8')).not.toContain('Refrigerator')

  const pdf = await downloadAs(page, /^Spec sheet \(PDF\)/, 'Download PDF')
  expect(pdf.suggestedFilename()).toBe('Home-kit.pdf')
  const bytes = await readFile((await pdf.path())!)
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  // The last check prints on page two: the fine print's assumed ratings take the room page one had left.
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the CSV parts list carries the solar parts when panels are chosen', async ({ page }) => {
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  await page.getByRole('button', { name: 'Build my kit' }).click()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await showDownload(page)
  const csv = await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV')
  const text = await readFile((await csv.path())!, 'utf8')
  expect(text).toContain('Solar panels')
  expect(text).toContain('Charge controller')
  expect(text.indexOf('Inverter')).toBeGreaterThan(-1)
  expect(text.indexOf('Inverter')).toBeLessThan(text.indexOf('Fuse'))
  expect(text.indexOf('Fuse')).toBeLessThan(text.indexOf('Solar panels'))
  expect(text.indexOf('Solar panels')).toBeLessThan(text.indexOf('Mounting'))
  const panelsLine = text.split('\n').find(line => line.startsWith('Solar panels'))
  expect(panelsLine?.trim()).toMatch(/,5$/)
  const feedLine = text.split('\n').find(line => line.startsWith('Controller to battery: cable and fuse'))
  expect(feedLine?.trim()).toMatch(/^Controller to battery: cable and fuse,80 A class T fuse · 4 AWG \(21\.2 mm²\) copper,.*,1$/)
  // The file closes on what the solar side does not size.
  expect(text.trimEnd().split('\n').at(-1)).toMatch(/^"This kit does not size the solar side's ground-fault and surge protection.*a qualified installer designs them\."$/)
})

test('export progress is visible while the file is being prepared', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  // Hold the on-demand PDF library request to observe progress without a timing race.
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route(/jspdf.*\.js/, async route => { await held; await route.continue() })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  try {
    await expect(page.getByRole('progressbar', { name: 'Preparing the file…' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preparing the file…' })).toBeDisabled()
    await expect(page.getByRole('radio').first()).toBeDisabled()
  } finally {
    release()
  }
  await downloaded
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: 'File ready. Download started.' })).toBeVisible()
})

/**
 * A capture that never finishes: the PDF one waits on its library, the PNG one on the canvas encoding. `underway`
 * settles once the capture has started, which is also once its 30 s limit is counting, so the test can run the clock out.
 */
const STUCK_CAPTURES = [
  {
    file: 'PDF', format: /^Spec sheet \(PDF\)/, button: 'Download PDF',
    hold: (page: Page) => page.route(/jspdf.*\.js/, () => {}),
    underway: (page: Page) => page.waitForRequest(/jspdf.*\.js/),
  },
  {
    file: 'PNG', format: /^Summary image \(PNG\)/, button: 'Download image',
    hold: (page: Page) => page.addInitScript(() => { HTMLCanvasElement.prototype.toBlob = () => { document.documentElement.dataset.held = 'true' } }),
    underway: (page: Page) => page.waitForFunction(() => document.documentElement.dataset.held === 'true'),
  },
] as const

for (const { file, format, button, hold, underway } of STUCK_CAPTURES) {
  test(`a ${file} capture still running after 30 s ends in the failed message and saves no file`, async ({ page }) => {
    await page.clock.install()
    await hold(page)
    await page.goto('/?step=4')
    await showDownload(page)
    await page.getByRole('radio', { name: format }).check()
    const saved: Download[] = []
    page.on('download', (download) => saved.push(download))
    const started = underway(page)
    await page.getByRole('button', { name: button }).click()
    await expect(page.getByRole('progressbar', { name: 'Preparing the file…' })).toBeVisible()
    await started
    await page.clock.fastForward(30_000)
    await expect(page.getByRole('alert')).toHaveText('Could not create the file. Try again.')
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: button })).toBeEnabled()
    expect(saved).toHaveLength(0)
  })
}

const pdfPageCount = async (file: Download) =>
  (await readFile((await file.path())!)).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0

test('the parts list comes first, and the load schedule gets a PDF page of its own', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const sheet = page.locator('.ksheet').filter({ visible: true })
  await expect(sheet.locator('h3')).toHaveText(['Parts list', 'Load schedule', 'Checks'])
  expect(await pdfPageCount(await downloadAs(page, /^Spec sheet \(PDF\)/, 'Download PDF'))).toBe(2)

  await page.getByRole('checkbox', { name: 'Appliance list' }).uncheck()
  await expect(sheet.locator('h3')).toHaveText(['Parts list', 'Checks'])
  // With no load schedule there is no page break, but the last check still prints on page two. Page one had 10.8 px to
  // spare before the fine print listed the assumed battery and inverter ratings (three lines, 50 px). The same sheet in
  // Spanish already printed its last check on page two before that.
  expect(await pdfPageCount(await downloadAs(page, /^Spec sheet \(PDF\)/, 'Download PDF'))).toBe(2)
})

test('the preview opens larger, page by page as the PDF prints, or as one image for PNG', PHONE, async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  await page.getByRole('button', { name: 'View larger' }).click()
  const view = page.getByRole('dialog', { name: 'Preview' })
  await expect(view.getByText('Page 1 of 2')).toBeVisible()
  await expect(view.getByText('Page 2 of 2')).toBeVisible()
  // An A4-shaped page, and big enough to read: at least 70% of the sheet's real size, even on a phone (it scrolls sideways).
  const firstPage = await view.locator('.pvw__page').first().boundingBox()
  expect(firstPage!.height / firstPage!.width).toBeCloseTo(841.89 / 595.28, 1)
  expect(firstPage!.width).toBeGreaterThanOrEqual(555)
  // The pages are pictures of the sheet (hidden from assistive tech); the load schedule sits on page 2.
  await expect(view.locator('.pvw__page').nth(1).getByText('Load schedule')).toBeVisible()
  // Screen readers get the sheet once, as real headings and tables, not once per page picture.
  await expect(view.getByRole('heading', { name: 'Load schedule' })).toHaveCount(1)
  await expect(view.getByRole('table')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(view).toBeHidden()
  await expect(page.getByRole('button', { name: 'View larger' })).toBeFocused()

  await page.getByRole('radio', { name: /^Summary image \(PNG\)/ }).check()
  await page.getByRole('button', { name: 'View larger' }).click()
  await expect(view.getByText('The whole sheet in one image')).toBeVisible()
  await expect(view.getByText(/^Page \d of \d$/)).toHaveCount(0)
})

test('a CSV has no printed pages, so there is no larger view to open', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  await page.getByRole('radio', { name: /^Parts list \(CSV\)/ }).check()
  await expect(page.getByRole('button', { name: 'View larger' })).toHaveCount(0)
  await page.getByRole('radio', { name: /^Spec sheet \(PDF\)/ }).check()
  await expect(page.getByRole('button', { name: 'View larger' })).toBeVisible()
})

test('notes and failing checks stay on the sheet and in the files with their Include boxes unticked', async ({ page }) => {
  // A 240 V water heater on a 12 V bank: three checks fail (parallel strings, fuse, cable) and three notes apply.
  await page.goto('/?step=1')
  await page.getByRole('button', { name: 'Add Electric water heater' }).click()
  await page.getByRole('button', { name: 'Step 2: Backup window' }).click()
  await page.getByRole('button', { name: /^12 V/ }).click()
  await page.getByRole('button', { name: 'Step 4: Your kit' }).click()
  await showDownload(page)
  const sheet = page.locator('.ksheet').filter({ visible: true })
  // The preview is hidden from assistive technology, so its check marks are looked up as hidden elements.
  const marks = (name: string) => sheet.getByRole('img', { name, includeHidden: true })
  await expect(sheet.getByText('Read before quoting · Checks to resolve: 3 · Notes: 3')).toBeVisible()
  await expect(marks('Passes')).toHaveCount(3)
  await page.getByRole('checkbox', { name: 'Checks' }).uncheck()
  await page.getByRole('checkbox', { name: 'Assumptions' }).uncheck()
  await expect(sheet.getByText(/usually runs on 240 V\. You need a split-phase \(240 V\) inverter/)).toBeVisible()
  // Unticking Checks takes the passing ones off the sheet; the three that fail stay.
  await expect(marks('Passes')).toHaveCount(0)
  await expect(marks('Needs attention')).toHaveCount(3)
  await expect(sheet.getByText(/A on the DC side at 12 V is hard to wire safely/)).toBeVisible()
  // Parts first, so page one keeps its layout; the notes print with the checks at the end.
  await expect(sheet.locator('h3')).toHaveText(['Parts list', 'Load schedule', 'Notes', 'Checks'])
  const csv = await downloadAs(page, /^Parts list \(CSV\)/, 'Download CSV')
  const text = await readFile((await csv.path())!, 'utf8')
  expect(text).toContain('Needs attention,Note')
  expect(text).toMatch(/^Cable,\d+ A on the DC side at 12 V is hard to wire safely\. Consider 24 V\.\r?$/m)
  expect(text).toMatch(/^Parallel strings,/m)
  expect(text).toContain('Note,Electric water heater usually runs on 240 V. You need a split-phase (240 V) inverter or two stacked units.')
  // The PDF is drawn from the sheet as previewed, so it carries the same blocks: it has to come out with them on it.
  const pdf = await downloadAs(page, /^Spec sheet \(PDF\)/, 'Download PDF')
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

/** Every channel under this is ink: the sheet's text on its white ground. */
const INK_MAX_CHANNEL = 128
/** Two lines of small type leave thousands of ink pixels in the image; a band where nothing printed leaves none. */
const MIN_INK_PIXELS = 1000

/** How many ink pixels the downloaded image has where `selector` sits on the sheet. */
async function inkUnder(page: Page, image: Download, selector: string): Promise<number> {
  const png = (await readFile((await image.path())!)).toString('base64')
  return page.locator('.ksheet').filter({ visible: true }).evaluate(async (sheet, { png, selector, inkMax }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' }))
    // The preview is the sheet scaled down and the image is the same sheet at full size, so one ratio maps between them.
    const frame = sheet.getBoundingClientRect()
    const target = sheet.querySelector(selector)!.getBoundingClientRect()
    const perPx = bitmap.width / frame.width
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const pen = canvas.getContext('2d')!
    pen.drawImage(bitmap, 0, 0)
    const { data } = pen.getImageData(Math.round((target.left - frame.left) * perPx), Math.round((target.top - frame.top) * perPx), Math.round(target.width * perPx), Math.round(target.height * perPx))
    return data.reduce((ink, _, i) => (i % 4 === 0 && data[i] < inkMax && data[i + 1] < inkMax && data[i + 2] < inkMax ? ink + 1 : ink), 0)
  }, { png, selector, inkMax: INK_MAX_CHANNEL })
}

for (const { lang, download, format, button } of [
  { lang: 'en', download: 'Download', format: /^Summary image \(PNG\)/, button: 'Download image' },
  { lang: 'es', download: 'Descargar', format: /^Imagen resumen \(PNG\)/, button: 'Descargar imagen' },
] as const) {
  test(`the downloaded image has the estimate sentence printed on it, with every Include box unticked (${lang})`, PHONE, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'lang', value: lang, url: baseURL! }])
    await page.goto('/?step=4')
    await showDownload(page, download)
    // The PDF pages are cut from this same image, so what is printed here is printed there.
    await page.getByRole('radio', { name: format }).check()
    const ticked = page.getByRole('checkbox', { checked: true, disabled: false })
    while (await ticked.count() > 0) await ticked.first().uncheck()
    const image = await downloadAs(page, format, button)
    expect(await inkUnder(page, image, '.ksheet__estimate')).toBeGreaterThan(MIN_INK_PIXELS)
  })
}

test('the checks print last on the sheet and can be left out', async ({ page }) => {
  await page.goto('/?step=4')
  await showDownload(page)
  const sheet = page.locator('.ksheet').filter({ visible: true })
  await expect(sheet.getByText('Battery continuous current')).toBeVisible()
  await expect(sheet.getByText('Average', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Checks' }).uncheck()
  await expect(sheet.locator('h3')).toHaveText(['Parts list', 'Load schedule'])
})
