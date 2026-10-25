import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { fmtKwh } from '../src/i18n/format'
import { quotesEn } from '../src/i18n/quotes-en'
import { quotesEs } from '../src/i18n/quotes-es'
import {
  cloneProject, countQuoteRows, firstProjectId, linkGoogleAccount, misreadQuoteLine, misreadQuoteTotal, quoteFiles, quoteRetryStates, seedFailedQuote,
  seedQuoteRows, setQuoteCurrency, setQuoteRetries, setQuoteUploadsThisMonth, setQuoteTotalOverride, stripQuoteOptions, trashedPaths,
} from './db'
import { captureGoogleRedirect, expectOurGoogleRequest } from './google'
import { switchLanguage, switchLanguageOnLoad } from './header'
import { PHONE } from './phone'
import { answerDelete, deleteAsk, hideProjects, openProjectAction, openProjectCard, showProjects } from './projects'
import {
  captureUploadCall, isJobsRead, isMustSave, isProjectRead, lockedPdf, openVerdictFromTray, pickQuoteFiles, postUpload, quotePdf, saved, signUp, signUpWithProject, slowQuotePdf, tray,
  uploadQuotes, verdictHeading,
} from './quotes'

const ALL = ['solartec', 'voltia', 'grupoluz', 'enerhogar']
/** Where the E2E server keeps quote files (QUOTES_LOCAL_DIR in playwright.config.ts). */
const QUOTE_FILES_DIR = '.data/e2e-quotes'
/** The file name of a real quote from the user's test project, as installers send them. */
const LONG_FILE_NAME = 'Quotation 0033688 09-16-2026- INVERSOR 3000W - CONDOMINIO VILLA MARTINIQUE - OFICINA 3'

test('quotes upload, are read in the background, and end in a verdict', PHONE, async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, await Promise.all(ALL.map(quotePdf)))
  const dialog = page.getByRole('dialog', { name: "We've got it from here" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Ok, got it' }).click()
  await expect(dialog).toBeHidden()
  await expect(tray(page)).toBeVisible()
  await openVerdictFromTray(page)

  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  await expect(page.getByText('$6,480, the cheapest of your 4 quotes that meets all 6 must-haves.')).toBeVisible()
  const rows = page.getByRole('article')
  await expect(rows.nth(0)).toContainText('Voltia Instalaciones')
  await expect(rows.nth(1)).toContainText('Grupo Luz')
  await expect(rows.nth(1)).toContainText('Worth asking')
  await expect(rows.nth(2)).toContainText('EnerHogar')
  await expect(page.getByRole('region', { name: 'What your kit needs' })).toBeVisible()
  const best = page.getByRole('region', { name: 'SolarTec Caribe' })
  await expect(best.getByRole('img', { name: /^Inverter: .+ needed, / })).toBeVisible()
  await expect(best.getByText('solartec.pdf')).toBeVisible()
  await expect(rows.nth(0)).toContainText('$820 more than the best')
  await expect(rows.nth(1)).toContainText('$330 less than the best')
  await expect(tray(page)).toBeHidden()
})

test('a cheaper quote that leaves a chemistry, a size and a fuse class open is worth asking, not the best fit', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, await Promise.all(['solartec', 'lumen'].map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  const lumen = page.getByRole('article').filter({ hasText: 'Lumen Energía' })
  await expect(lumen).toContainText('3 unclear')
  await expect(lumen).toContainText("Doesn't confirm the battery chemistry, the size of the main cables, and a class T fuse instead of ANL.")
  await expect(lumen).toContainText('To confirm: cables and fuse')
  await expect(lumen).toContainText('Worth asking')
  await lumen.getByRole('button', { name: 'Show checks for Lumen Energía', exact: true }).click()
  const check = (name: string) => lumen.getByRole('listitem').filter({ hasText: name })
  await expect(check('Battery bank')).toContainText(`Chemistry not stated: ${fmtKwh(3600, 'en')} usable if AGM lead-acid, ${fmtKwh(6120, 'en')} if LiFePO₄ lithium`)
  await expect(check('Main cables')).toContainText('Size not stated')
  await expect(check('Class T fuse')).toContainText('ANL fuse; your kit asks for class T')

  // Confirming the three with the installer makes it the cheapest that fits, with the three left to confirm on its card,
  // and SolarTec the one with nothing to confirm.
  for (const name of ['Battery bank', 'Main cables', 'Class T fuse']) {
    const save = saved(page, 'item')
    await lumen.getByRole('group', { name, exact: true }).getByRole('button', { name: quotesEn.overrideConfirmed, exact: true }).click()
    await save
  }
  await expect(verdictHeading(page)).toHaveText('Lumen Energía is the cheapest that fits: confirm 3 things first')
  const best = page.getByRole('region', { name: 'Lumen Energía' })
  await expect(best.getByText(quotesEn.bestFitToConfirm, { exact: true })).toBeVisible()
  await expect(best.getByRole('note')).toContainText(quotesEn.caveatsTitle)
  await expect(best.getByRole('note')).toContainText('Battery bank: you confirmed it, the quote does not say it')
  await expect(page.getByRole('article').filter({ hasText: 'SolarTec Caribe' })).toContainText('Meets every must-have with nothing to confirm. Costs $1,280 more.')
})

test('a kit with solar panels asks quotes for them, and panels can be made a nice-to-have', async ({ page }) => {
  await signUp(page)
  await page.goto('/?step=3')
  await page.getByRole('button', { name: /^Yes, add panels/ }).click()
  // A click before the page hydrates does nothing: the planner shows the kit has panels before the step is left.
  await expect(page.getByRole('group', { name: /Roof planner/ })).toBeVisible()
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  await expect(verdictHeading(page)).toHaveText(quotesEn.headingNone)
  await expect(page.getByRole('region', { name: 'What your kit needs' })).toContainText(quotesEn.needArray)
  const row = page.getByRole('article').filter({ hasText: 'SolarTec Caribe' })
  await expect(row).toContainText("Doesn't mention solar panels.")

  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'What matters for this project' })
  const save = saved(page, 'musts')
  await sheet.getByRole('switch', { name: 'Solar panels', exact: true }).click()
  await save
  await sheet.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
})

test('the same quote uploaded twice ranks once with a warning, and inverter and battery stay must-haves (AI-28)', async ({ page }) => {
  await signUp(page)
  // The stub reads both files as SolarTec's quote: one file sent twice under two names.
  await uploadQuotes(page, await Promise.all(['solartec', 'solartec-copy', 'voltia'].map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  await expect(page.getByText('$6,480, the cheapest of your 2 quotes that meets all 6 must-haves.')).toBeVisible()
  const copy = page.getByRole('article').filter({ hasText: quotesEn.duplicate })
  await expect(copy).toHaveCount(1)
  await expect(copy).toContainText(quotesEn.duplicateHelp)

  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'What matters for this project' })
  for (const name of ['Inverter', 'Battery bank']) {
    const fixed = sheet.getByRole('switch', { name, exact: true })
    await expect(fixed).toHaveAttribute('aria-checked', 'true')
    await expect(fixed).toBeDisabled()
  }
})

test('a tie between currencies says on screen which one was compared (AI-28)', async ({ page }) => {
  const email = await signUp(page)
  await uploadQuotes(page, await Promise.all(['solartec', 'voltia'].map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  await expect(page.getByText(/same number of quotes to compare/)).toHaveCount(0)

  // Voltia's quote read in euros: one quote in each currency, and SolarTec's was uploaded first.
  await setQuoteCurrency(email, await firstProjectId(email), 'voltia.pdf', 'EUR')
  await page.reload()
  await expect(page.getByRole('note').filter({ hasText: 'same number of quotes to compare' }))
    .toHaveText('USD and EUR have the same number of quotes to compare. Only the ones in USD are compared, as the earliest of those quotes is in USD.')
  await expect(page.getByRole('article').filter({ hasText: 'Voltia Instalaciones' })).toContainText('In EUR, so not compared')
})

test('must-haves and confirmations change the winner, and stick', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, await Promise.all(ALL.map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')

  const grupo = page.getByRole('article').filter({ hasText: 'Grupo Luz' })
  await grupo.getByRole('button', { name: 'Show checks for Grupo Luz', exact: true }).click()
  let save = saved(page, 'item')
  await grupo.getByRole('group', { name: 'Battery charger', exact: true }).getByRole('button', { name: 'Included', exact: true }).click()
  await save
  save = saved(page, 'item')
  await grupo.getByRole('group', { name: 'Class T fuse', exact: true }).getByRole('button', { name: 'Included', exact: true }).click()
  await save
  await expect(verdictHeading(page)).toHaveText('Grupo Luz fits your kit for the least')
  await page.reload()
  await expect(verdictHeading(page)).toHaveText('Grupo Luz fits your kit for the least')

  // Un-confirming the charger on the best-fit card drops Grupo Luz back to "unclear": it stops being the best fit at once,
  // so its card is replaced by SolarTec's and Grupo Luz becomes a row in the list, with its checks closed.
  const best = page.getByRole('region', { name: 'Grupo Luz' })
  await best.getByRole('button', { name: 'Show checks for Grupo Luz', exact: true }).click()
  await best.getByRole('group', { name: 'Battery charger', exact: true }).getByRole('button', { name: 'Included', exact: true }).click()
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  const row = page.getByRole('article').filter({ hasText: 'Grupo Luz' })
  await row.getByRole('button', { name: 'Show checks for Grupo Luz', exact: true }).click()
  await row.getByRole('group', { name: 'Class T fuse', exact: true }).getByRole('button', { name: 'Included', exact: true }).click()
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')

  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'What matters for this project' })
  save = saved(page, 'musts')
  await sheet.getByRole('switch', { name: 'Battery charger', exact: true }).click()
  await save
  save = saved(page, 'musts')
  await sheet.getByRole('switch', { name: 'Class T fuse', exact: true }).click()
  await save
  await sheet.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(verdictHeading(page)).toHaveText('Grupo Luz fits your kit for the least')
  await page.reload()
  await expect(verdictHeading(page)).toHaveText('Grupo Luz fits your kit for the least')
})

test('a must-have that fails to save goes back, and one saved meanwhile is kept, on screen and on the server', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  // The first save is held until the second has answered, then it fails: the second lands first on the server.
  let released: () => void = () => {}
  const secondAnswered = new Promise<void>((resolve) => { released = resolve })
  let calls = 0
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || !isMustSave(request.postData() ?? '')) return route.fallback()
    calls += 1
    if (calls === 1) {
      await secondAnswered
      return route.abort()
    }
    await route.fulfill({ response: await route.fetch() })
    released()
  })

  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'What matters for this project' })
  const wifi = sheet.getByRole('switch', { name: 'Wi-Fi monitoring', exact: true })
  const warranty = sheet.getByRole('switch', { name: 'Warranty', exact: true })
  await expect(wifi).toHaveAttribute('aria-checked', 'false')
  await expect(warranty).toHaveAttribute('aria-checked', 'false')
  await wifi.click()
  await warranty.click()
  await expect(sheet.getByText("Couldn't save. Try again.")).toBeVisible()
  await expect(wifi).toHaveAttribute('aria-checked', 'false')
  await expect(warranty).toHaveAttribute('aria-checked', 'true')
  await page.unroute('**/*')

  await page.reload()
  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  await expect(wifi).toHaveAttribute('aria-checked', 'false')
  await expect(warranty).toHaveAttribute('aria-checked', 'true')
})

test('a reload that lands while a must-have is saving keeps the change on screen', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec'), await quotePdf('voltia')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  await expect(page.getByRole('article')).toHaveCount(1)

  // The must-have save is held until the page has reloaded its data, which it read before the save landed.
  let release: () => void = () => {}
  const reloaded = new Promise<void>((resolve) => { release = resolve })
  let isHeld = false
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST' || !isMustSave(request.postData() ?? '')) return route.fallback()
    isHeld = true
    await reloaded
    await route.fulfill({ response: await route.fetch() })
  })

  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'What matters for this project' })
  const wifi = sheet.getByRole('switch', { name: 'Wi-Fi monitoring', exact: true })
  await expect(wifi).toHaveAttribute('aria-checked', 'false')
  const save = saved(page, 'musts')
  await wifi.click()
  await expect.poll(() => isHeld).toBe(true)
  await sheet.getByRole('button', { name: 'Done', exact: true }).click()

  // Deleting a quote reloads the page's data while the save is still held.
  const best = page.getByRole('region').filter({ has: page.getByText('Best fit', { exact: true }) })
  await best.getByRole('button', { name: 'Delete', exact: true }).click()
  await best.getByRole('button', { name: 'Delete it' }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  await expect(wifi).toHaveAttribute('aria-checked', 'true')

  release()
  await save
  await page.unroute('**/*')
  await page.reload()
  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  await expect(wifi).toHaveAttribute('aria-checked', 'true')
})

test('a reload that read the data before a must-have saved, but answers after the save, keeps the change', async ({ page }) => {
  test.slow()
  await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  // When the second quote finishes, the page reloads its data. That read happens first; only then does the must-have
  // save reach the server; and the read's (older) answer arrives last, after the page has handled the save's.
  const signal = () => {
    let fire: () => void = () => {}
    const done = new Promise<void>((resolve) => { fire = resolve })
    return { fire: () => fire(), done }
  }
  const staleRead = signal()
  const saveAnswered = signal()
  const staleDelivered = signal()
  let isArmed = false
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && isMustSave(request.postData() ?? '')) {
      isArmed = true
      await staleRead.done
      await route.fulfill({ response: await route.fetch() })
      saveAnswered.fire()
      return
    }
    if (isArmed && request.method() === 'GET' && isProjectRead(request.url())) {
      isArmed = false
      const response = await route.fetch()
      staleRead.fire()
      await saveAnswered.done
      await new Promise((resolve) => setTimeout(resolve, 500))
      await route.fulfill({ response })
      staleDelivered.fire()
      return
    }
    return route.fallback()
  })

  // Adding a quote reloads the page once while it is read; the must-have is changed after that reload. The quote is
  // a slow one, so it is still being read by then, and the reload for its finish comes after the change.
  const addedReload = page.waitForResponse((r) => r.request().method() === 'GET' && isProjectRead(r.url()))
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add another quote' }).click()
  await (await chooser).setFiles([await slowQuotePdf('voltia')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await addedReload

  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'What matters for this project' })
  const wifi = sheet.getByRole('switch', { name: 'Wi-Fi monitoring', exact: true })
  await expect(wifi).toHaveAttribute('aria-checked', 'false')
  await wifi.click()
  await sheet.getByRole('button', { name: 'Done', exact: true }).click()

  await staleDelivered.done
  // The older read was applied: it brought the second quote.
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  await expect(wifi).toHaveAttribute('aria-checked', 'true')

  await page.unroute('**/*')
  await page.reload()
  await page.getByRole('button', { name: 'Change must-haves', exact: true }).click()
  await expect(wifi).toHaveAttribute('aria-checked', 'true')
})

test('a verdict that finished while away shows once in the tray', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await expect(tray(page).getByRole('link', { name: 'See verdict' })).toBeVisible({ timeout: 30_000 })
  await page.reload()
  await expect(tray(page)).toContainText('Verdict ready for Home')
  await tray(page).getByRole('button', { name: 'Dismiss' }).click()
  await expect(tray(page)).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Kit for Home' })).toBeVisible()
  await expect(tray(page)).toBeHidden()
})

test("another project's verdict opened from the tray is read once, not again on the first poll", async ({ page }) => {
  // Sign-up, an upload and database seeding over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const readyId = await firstProjectId(email)
  // A second project whose one quote could not be read. Its verdict page offers the first project's in the tray, and
  // following that link keeps the page and changes only its project.
  const otherId = randomUUID()
  await cloneProject(email, otherId)
  await seedFailedQuote(email, otherId, 'other.pdf')
  await page.goto(`/projects/${otherId}/quotes`)
  const seeVerdict = tray(page).getByRole('link', { name: 'See verdict' })
  await expect(seeVerdict).toBeVisible({ timeout: 30_000 })

  const reads: string[] = []
  page.on('request', (r) => { if (r.method() === 'GET' && isProjectRead(r.url())) reads.push(r.url()) })
  // Opening a verdict marks it seen, then reads the jobs again: a second read of the project would be on its way by then.
  const jobsRead = page.waitForResponse((r) => r.request().method() === 'GET' && isJobsRead(r.url()))
  await seeVerdict.click()
  await expect(page).toHaveURL(`/projects/${readyId}/quotes`)
  await expect(page.getByText('solartec.pdf')).toBeVisible()
  await jobsRead
  expect(reads).toHaveLength(1)
})

test('a file of the wrong type is refused before upload, with the reason', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }])
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'notes.txt' })).toContainText('Only PDF, JPG, PNG or WebP files can be read.')
})

test('a password-protected PDF is refused as locked, not as the wrong type, and the reason says how to fix it', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, [lockedPdf()])
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'locked.pdf' })).toContainText(quotesEn.errEncrypted)
  await expect(dialog).not.toContainText(quotesEn.errType)
})

test('the dialog for a password-protected PDF gives the reason and the one-file hint in Spanish', async ({ page }) => {
  await signUp(page)
  await page.goto('/?step=4')
  await switchLanguageOnLoad(page, 'Español')
  await pickQuoteFiles(page, [lockedPdf()], quotesEs.cardUpload)
  const dialog = page.getByRole('dialog', { name: quotesEs.handoffNone })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'locked.pdf' })).toContainText(quotesEs.errEncrypted)
  await expect(dialog).not.toContainText(quotesEs.errType)
  await expect(dialog.getByText(quotesEs.oneFilePerQuote)).toBeVisible()
})

test('both upload buttons and the dialog say one file per quote, in English and Spanish', async ({ page }) => {
  await signUp(page)
  await page.goto('/?step=4')
  // The hint sits by the Upload button and is its description, so a screen reader reads it with the button.
  const upload = page.getByRole('button', { name: 'Upload quotes', exact: true })
  await expect(upload).toHaveAccessibleDescription(quotesEn.oneFilePerQuote)
  await expect(page.getByText(quotesEn.oneFilePerQuote)).toBeVisible()

  await pickQuoteFiles(page, [await quotePdf('solartec')])
  const dialog = page.getByRole('dialog', { name: "We've got it from here" })
  await expect(dialog.getByText(quotesEn.oneFilePerQuote)).toBeVisible()
  await dialog.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  const addAnother = page.getByRole('button', { name: 'Add another quote' })
  await expect(addAnother).toHaveAccessibleDescription(quotesEn.oneFilePerQuote)
  await switchLanguage(page, 'Español')
  await expect(page.getByRole('button', { name: quotesEs.addAnother })).toHaveAccessibleDescription(quotesEs.oneFilePerQuote)

  await page.goto('/?step=4')
  await expect(page.getByRole('button', { name: quotesEs.cardAddMore, exact: true })).toHaveAccessibleDescription(quotesEs.oneFilePerQuote)
  await expect(page.getByText(quotesEs.oneFilePerQuote)).toBeVisible()
})

test('another account gets 404 for the file and the verdict', async ({ page, browser }) => {
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  const href = await page.getByRole('link', { name: 'View original' }).first().getAttribute('href')
  expect(href).toMatch(/^\/api\/quotes\/[0-9a-f-]{36}\/file$/)
  const own = await page.request.get(href!)
  expect(own.status()).toBe(200)
  expect(own.headers()['content-type']).toBe('application/pdf')
  // No CSP sandbox on a PDF, or Chrome's PDF viewer refuses to show it; nosniff stays.
  expect(own.headers()['content-security-policy']).toBeUndefined()
  expect(own.headers()['x-content-type-options']).toBe('nosniff')
  const verdictUrl = page.url()

  const other = await browser.newContext()
  const stranger = await other.newPage()
  const { email: strangerEmail } = await signUpWithProject(stranger)
  expect((await stranger.request.get(href!)).status()).toBe(404)
  // The project exists only for the owner: a real 404.
  await stranger.goto(verdictUrl)
  await expect(stranger.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  // Accounts made before first projects took ids of their own all have one under the same id. For two of those the
  // same address shows the stranger their own, empty verdict: none of the owner's quotes.
  await cloneProject(strangerEmail, await firstProjectId(email))
  await stranger.goto(verdictUrl)
  await expect(stranger.getByRole('heading', { name: 'No quotes yet' })).toBeVisible()
  await expect(stranger.getByText('SolarTec')).toHaveCount(0)
  await other.close()
})

test('the hand-off dialog shows each file reading, then lets a file that could not be read be retried from there', async ({ page }) => {
  test.slow()
  await signUp(page)
  // The stub reads only the sample quotes; any other file name fails on both models. This one takes its time, so the
  // dialog shows it being read, the first time and after the retry.
  const unreadable = await slowQuotePdf('unreadable')
  await uploadQuotes(page, [unreadable])
  const dialog = page.getByRole('dialog', { name: "We've got it from here" })
  const row = dialog.getByRole('listitem').filter({ hasText: unreadable.name })
  await expect(row.getByText(/^(Uploading|Waiting|Reading) · about 30 s · \d+:\d{2} so far$/)).toBeVisible()
  await expect(dialog.getByText('1 reading')).toBeVisible()

  await expect(row.getByText("Couldn't read it", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText('1 needs your attention')).toBeVisible()
  await expect(dialog.getByRole('button', { name: `Delete ${unreadable.name}` })).toBeVisible()
  await row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(row.getByText(/^(Waiting|Reading) · about 30 s · \d+:\d{2} so far$/)).toBeVisible()

  const watch = dialog.getByRole('link', { name: 'Watch progress' })
  await expect(watch).toHaveCSS('text-decoration-line', 'none')
  await watch.click()
  await expect(page.getByRole('article').filter({ hasText: unreadable.name }).getByText('Uploaded', { exact: true })).toBeVisible()
})

test('a quote that could not be read can be retried, until its retries are used up, on the page and on the server', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  // The stub reads only the sample quotes; any other file name fails on both models. This one takes its time, so the
  // row shows it being read again after the retry.
  const unreadable = await slowQuotePdf('unreadable')
  await uploadQuotes(page, [unreadable])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)

  const row = page.getByRole('article').filter({ hasText: unreadable.name })
  const failed = row.getByText("Couldn't read it", { exact: true })
  await expect(failed).toBeVisible({ timeout: 30_000 })
  await expect(row.getByText('Uploaded', { exact: true })).toBeVisible()
  await expect(row.getByText('3 tries left')).toBeVisible()
  const retryCall = page.waitForRequest((r) => r.method() === 'POST' && (r.postData() ?? '').includes('"quoteId"'))
  await row.getByRole('button', { name: 'Retry', exact: true }).click()
  const retry = await retryCall
  await expect(row.getByText(/^(Waiting|Reading)$/)).toBeVisible()
  await expect(failed).toBeVisible({ timeout: 30_000 })

  await setQuoteRetries(email, projectId, 3)
  await page.reload()
  await expect(row.getByText("Couldn't read it after several tries. Upload a clearer copy.")).toBeVisible()
  await expect(row.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)

  // The page hides the button, but the server holds the cap too: the same retry call, sent again, is refused. It is
  // sent as the page sends it, from the page's own origin, so the server functions' CSRF check lets it through.
  const headers = await retry.allHeaders()
  const again = await page.request.post(retry.url(), {
    headers: { 'content-type': headers['content-type'], accept: headers.accept, 'x-tsr-serverfn': 'true', origin: new URL(page.url()).origin },
    data: retry.postData() ?? '',
  })
  // A server function answers a thrown error inside the serialized result, so the refusal is read from the body.
  const body = await again.text()
  expect(body).toContain('$TSR/Error')
  expect(body).toContain('Not found')
  expect(await quoteRetryStates(email, projectId)).toEqual([{ status: 'failed', retries: 3 }])
})

test('a project that already has 10 quotes refuses an eleventh, with the reason', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  await seedQuoteRows(email, projectId, 10)

  // Once the project has quotes, the card's button reads "Add quotes". The page may learn of the seeded rows at any
  // moment, so the upload reloads the kit and goes through that label, which no longer changes.
  await uploadQuotes(page, [await quotePdf('solartec')], quotesEn.cardAddMore)
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'solartec.pdf' })).toContainText('This project already has 10 quotes.')
  expect(await countQuoteRows(email, projectId)).toBe(10)
})

test('an account that used its 20 uploads this month is refused, with the reason', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  await setQuoteUploadsThisMonth(email, 20)

  await uploadQuotes(page, [await quotePdf('solartec')])
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog.getByRole('listitem').filter({ hasText: 'solartec.pdf' })).toContainText("You've uploaded 20 quotes this month. The limit resets on the 1st.")
  expect(await countQuoteRows(email, projectId)).toBe(0)
})

/** Signs up and uploads one quote to a new project, which is the open one. Returns the account and its quote's row. */
async function signUpWithOneQuoteInANewProject(page: Page) {
  const email = await signUp(page)
  await page.goto('/')
  await showProjects(page)
  await page.getByRole('button', { name: '+ New project' }).click()
  await hideProjects(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await expect.poll(async () => (await quoteFiles(email)).length).toBe(1)
  const [quote] = await quoteFiles(email)
  return { email, quote: quote! }
}

test('deleting a project asks first, naming its quotes, and Cancel keeps the project and its quotes', async ({ page }) => {
  const { email, quote } = await signUpWithOneQuoteInANewProject(page)

  await page.goto('/')
  await showProjects(page)
  // The card shows its quotes line once the page has read the jobs; the question counts from the same jobs.
  await expect(openProjectCard(page).getByRole('link')).toBeVisible()
  await openProjectAction(page, 'Delete')
  await expect(deleteAsk(page)).toHaveText("Delete “Project 2” and its 1 quote? Its file goes too. This can't be undone.")
  await answerDelete(page, 'Cancel')
  await expect(deleteAsk(page)).toHaveCount(0)
  await expect(openProjectCard(page).getByRole('heading')).toHaveText('Project 2')
  expect(await countQuoteRows(email, quote.projectId)).toBe(1)
  expect(existsSync(path.resolve(QUOTE_FILES_DIR, quote.path))).toBe(true)
})

test('until the account\'s quotes are read, the delete question says any quotes go too, then names them once read', async ({ page }) => {
  await signUpWithOneQuoteInANewProject(page)
  // The page's reads of the quote jobs wait until the test lets them through.
  let letJobsThrough = () => {}
  const jobsHeld = new Promise<void>((resolve) => { letJobsThrough = resolve })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'GET' && isJobsRead(route.request().url())) await jobsHeld
    await route.continue()
  })

  await page.goto('/')
  await showProjects(page)
  await openProjectAction(page, 'Delete')
  await expect(deleteAsk(page)).toHaveText("Delete “Project 2” and any quotes it has? Their files go too. This can't be undone.")
  letJobsThrough()
  await expect(deleteAsk(page)).toHaveText("Delete “Project 2” and its 1 quote? Its file goes too. This can't be undone.")
})

test('deleting a project removes its quotes and their files', async ({ page }) => {
  const { email, quote } = await signUpWithOneQuoteInANewProject(page)
  const file = path.resolve(QUOTE_FILES_DIR, quote.path)
  expect(existsSync(file)).toBe(true)

  await page.goto('/')
  await showProjects(page)
  await expect(openProjectCard(page).getByRole('link')).toBeVisible()
  const removed = page.waitForResponse((r) => r.request().method() === 'POST' && (r.request().postData() ?? '').includes('"ids"'))
  await openProjectAction(page, 'Delete')
  await answerDelete(page, 'Delete project')
  expect((await removed).ok()).toBe(true)
  expect(await countQuoteRows(email, quote.projectId)).toBe(0)
  expect(existsSync(file)).toBe(false)
  // The file was trashed with the rows and removed right away, so nothing is left for the sweep.
  expect(await trashedPaths([quote.path])).toEqual([])
})

test('deleting a quote removes its file and leaves nothing in the trash', async ({ page }) => {
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  const [quote] = await quoteFiles(email)
  const file = path.resolve(QUOTE_FILES_DIR, quote!.path)
  expect(existsSync(file)).toBe(true)

  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const removed = page.waitForResponse((r) => r.request().method() === 'POST' && (r.request().postData() ?? '').includes('"quoteId"'))
  await page.getByRole('button', { name: 'Delete it' }).click()
  expect((await removed).ok()).toBe(true)
  expect(await countQuoteRows(email, quote!.projectId)).toBe(0)
  expect(existsSync(file)).toBe(false)
  expect(await trashedPaths([quote!.path])).toEqual([])
})

test('Delete on a quote asks with focus on Cancel, and Cancel gives focus back to Delete, on the verdict and progress rows', async ({ page }) => {
  // Sign-up, an upload and database seeding over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  // A quote that could not be read sits beside the verdict as a progress card, with its own Delete.
  await seedFailedQuote(email, await firstProjectId(email), 'unreadable.pdf')
  await page.reload()

  const best = page.getByRole('region').filter({ has: page.getByText('Best fit', { exact: true }) })
  const failed = page.getByRole('article').filter({ hasText: 'unreadable.pdf' })
  for (const [row, deleteName] of [[best, 'Delete'], [failed, 'Delete unreadable.pdf']] as const) {
    const remove = row.getByRole('button', { name: deleteName, exact: true })
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(row.getByRole('alert')).toHaveText('Delete this quote and its file?')
    await expect(row.getByRole('button', { name: 'Delete it', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(row.getByRole('alert')).toHaveCount(0)
    await expect(remove).toBeFocused()
  }
})

test('an unverified account sees a note and Connect Google instead of the Upload button, and the server refuses its upload', async ({ page, browser, baseURL }) => {
  // Two sign-ups and database reads over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  // The upload call's address, from a verified account. The call is stopped before it reaches the server.
  const verified = await browser.newPage()
  const call = captureUploadCall(verified)
  try {
    await signUp(verified)
    await uploadQuotes(verified, [await quotePdf('solartec')])
    await call
  } finally {
    await verified.close()
  }

  const email = await signUp(page, { verified: false })
  await page.goto('/?step=4')
  const card = page.getByRole('region', { name: 'Got quotes from installers?' })
  await expect(card).toContainText('Uploading quotes needs a verified account.')
  await expect(page.getByRole('button', { name: 'Upload quotes', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Connect Google to upload quotes' })).toBeVisible()

  // The page offers no upload, and the server refuses one sent anyway, before storing anything.
  await expect.poll(() => firstProjectId(email).then(() => true, () => false), { timeout: 15_000 }).toBe(true)
  const projectId = await firstProjectId(email)
  const refused = await postUpload(page, await call, projectId, await quotePdf('solartec'))
  const body = await refused.text()
  expect(body).toContain('unverified')
  expect(body).not.toContain('$TSR/Error')
  expect(await countQuoteRows(email, projectId)).toBe(0)
  expect((await quoteFiles(email)).length).toBe(0)

  // Connecting Google verifies the account: the button links Google to this signed-in account (not a new sign-in),
  // and the browser then heads to Google with our callback.
  const googleUrl = await captureGoogleRedirect(page)
  const link = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/auth/link-social')
  await card.getByRole('button', { name: 'Connect Google to upload quotes' }).click()
  await link
  await expect.poll(googleUrl).not.toBeNull()
  expectOurGoogleRequest(googleUrl(), baseURL!)
})

test('on the verdict page, an unverified account gets Connect Google instead of Add another quote, and no Retry', async ({ page }) => {
  // Sign-up and database seeding over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page, { verified: false })
  await page.goto('/?step=4')
  await expect.poll(() => firstProjectId(email).then(() => true, () => false), { timeout: 15_000 }).toBe(true)
  const projectId = await firstProjectId(email)
  await seedQuoteRows(email, projectId, 1)

  await page.goto(`/projects/${projectId}/quotes`)
  const row = page.getByRole('article').filter({ hasText: 'seed-1.pdf' })
  await expect(row.getByText("Couldn't read it", { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  await expect(row.getByText(quotesEn.retryLimit)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add another quote' })).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Connect Google to upload quotes' })).toBeVisible()

  // A link that fails before leaving for Google says so where the button is.
  await page.route('**/api/auth/link-social', (route) => route.fulfill({ status: 500, json: { message: 'e2e failure' } }))
  await page.getByRole('button', { name: 'Connect Google to upload quotes' }).click()
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't connect Google. Try again." })).toBeVisible()
})

test('a password account with a Google account whose token verifies its email can upload, though its email was never marked verified', async ({ page }) => {
  // Sign-up and database writes over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page, { verified: false })
  await linkGoogleAccount(email)
  await page.goto('/?step=4')
  await expect(page.getByRole('button', { name: 'Upload quotes', exact: true })).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Connect Google to upload quotes' })).toHaveCount(0)
})

test('a Google account whose email Google did not verify does not unlock uploads', async ({ page }) => {
  // Sign-up and database writes over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page, { verified: false })
  await linkGoogleAccount(email, { emailVerified: false })
  await page.goto('/?step=4')
  const card = page.getByRole('region', { name: 'Got quotes from installers?' })
  await expect(card).toContainText('Uploading quotes needs a verified account.')
  await expect(page.getByRole('button', { name: 'Upload quotes', exact: true })).toHaveCount(0)
})

test('a project whose quotes all failed says none could be read, not that a verdict is ready', async ({ page }) => {
  // Sign-up and database seeding over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const { email, projectId } = await signUpWithProject(page)
  await seedQuoteRows(email, projectId, 2)

  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText("We couldn't read your quotes")
  await expect(page.getByText('Retry them, or check that each file is an installer quote.')).toBeVisible()
  const status = page.getByRole('status')
  await expect(status).toHaveText("2 couldn't be read")
  await expect(page.getByText('Verdict ready')).toHaveCount(0)
})

/** The best card's first gauge: each zone name ends before the next one starts. */
async function expectZoneNamesApart(page: Page): Promise<void> {
  // Each zone name is a grid item stretched to its column, so its own box never overlaps the next; the box of its
  // text does when the names collide.
  const names = page.getByRole('region', { name: 'SolarTec Caribe' }).locator('.qgauge').first().locator('.qgauge__name')
  const boxes = await names.evaluateAll((spans) => spans.map((span) => {
    const range = document.createRange()
    range.selectNodeContents(span)
    const { x, width } = range.getBoundingClientRect()
    return { x, width }
  }))
  expect(boxes).toHaveLength(4)
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1]!
    const cur = boxes[i]!
    expect(prev.x + prev.width).toBeLessThanOrEqual(cur.x + 0.5)
  }
}

test('on a phone, every card keeps its name, total, reason and gauge labels apart', PHONE, async ({ page }, testInfo) => {
  const isPhone = testInfo.project.name === 'phone'
  await signUp(page)
  // A real installer's file name, long and without spaces to break at: it must be cut short, not widen the page.
  const files = await Promise.all(ALL.map((id) => quotePdf(id === 'voltia' ? `${id}-${LONG_FILE_NAME}` : id)))
  await uploadQuotes(page, files)
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  await expect(page.getByText(LONG_FILE_NAME, { exact: false })).toBeVisible()
  // A phone widens its layout viewport to fit wider content and zooms out, so window.innerWidth grows with the page:
  // compare against the device's own width instead.
  const deviceWidth = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(deviceWidth)

  if (isPhone) {
    for (const card of await page.getByRole('article').all()) {
      const name = await card.getByRole('heading', { level: 3 }).boundingBox()
      const total = await card.locator('.qrow__total').boundingBox()
      const reason = await card.locator('.qrow__reason').boundingBox()
      if (!name || !total || !reason) throw new Error('a card is missing its name, total or reason')
      expect(name.x + name.width).toBeLessThanOrEqual(total.x)
      expect(reason.width).toBeGreaterThanOrEqual(200)
    }
    await expectZoneNamesApart(page)
  }

  await page.screenshot({ path: testInfo.outputPath(`verdict-${testInfo.project.name}-en.png`), fullPage: true })
  await switchLanguage(page, 'Español')
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe cumple con tu kit por menos')
  if (isPhone) await expectZoneNamesApart(page)
  await page.screenshot({ path: testInfo.outputPath(`verdict-${testInfo.project.name}-es.png`), fullPage: true })
})

const SUNA_O1 = 'Option 1 of 2 · Inversor 3 kW · suna.pdf'
const SUNA_O2 = 'Option 2 of 2 · Inversor 10 kW · suna.pdf'

test('a quote that offers two systems shows a card for each, priced on its own, and asks for no total', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, await Promise.all(['solartec', 'suna'].map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)

  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  const suna = page.getByRole('article').filter({ hasText: 'SUNA M.P.' })
  await expect(suna).toHaveCount(2)
  const small = suna.filter({ hasText: SUNA_O1 })
  const large = suna.filter({ hasText: SUNA_O2 })
  await expect(small).toContainText('$2,600')
  await expect(small).toContainText('unclear')
  // Each option is sized on its own inverter, not on the quote's biggest.
  await expect(small).toContainText('Inverter: 3,000 W against')
  await expect(large).toContainText('$6,200')
  await expect(large).toContainText('unclear')
  await expect(large).toContainText('Inverter: 10.0 kW against 465 W needed')
  await expect(page.getByLabel(quotesEn.totalInQuote)).toHaveCount(0)
})

test('a quote read before options can be read again, and then shows a card per option', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('suna')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(page.getByText(SUNA_O2)).toBeVisible({ timeout: 30_000 })

  await stripQuoteOptions(email, projectId)
  await page.reload()
  const row = page.getByRole('article').filter({ hasText: 'suna.pdf' })
  await expect(row.getByText(quotesEn.noTotalHelp)).toBeVisible()
  await row.getByRole('button', { name: quotesEn.readAgain }).click()

  await expect(page.getByText(SUNA_O1)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(SUNA_O2)).toBeVisible()
  expect(await quoteRetryStates(email, projectId)).toEqual([{ status: 'ready', retries: 1 }])
})

test('a total that failed its check is asked for in an empty field; a misread line is read again before its total can be typed', async ({ page }) => {
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least', { timeout: 30_000 })

  // A dropped digit: the lines add up to 6,480, the total was read as 648.
  await misreadQuoteTotal(email, projectId, 648)
  await page.reload()
  const row = page.getByRole('article').filter({ hasText: 'SolarTec Caribe' })
  const field = row.getByRole('textbox', { name: quotesEn.totalInQuote })
  await expect(field).toHaveValue('')
  await expect(row).toContainText('We read $648, but its lines and tax add up to $6,480.')
  await row.getByRole('button', { name: quotesEn.save, exact: true }).click()
  await expect(row.getByRole('alert')).toHaveText(quotesEn.totalInvalid)
  await field.fill('6,480')
  await row.getByRole('button', { name: quotesEn.save, exact: true }).click()
  // Ranked on a total the user typed, it is the cheapest that fits with that one thing to confirm.
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe is the cheapest that fits: confirm 1 thing first')
  await expect(page.getByRole('region', { name: 'SolarTec Caribe' })).toContainText(quotesEn.totalTyped)
  await expect(page.getByRole('region', { name: 'SolarTec Caribe' }).getByRole('note')).toContainText(quotesEn.caveatTyped)

  // A line whose amount its quantity and unit price don't make: the typed total no longer ranks it.
  await misreadQuoteLine(email, projectId, 1)
  await page.reload()
  await expect(verdictHeading(page)).toHaveText(quotesEn.headingNone)
  await expect(row).toContainText(quotesEn.misreadLines)
  await expect(row.getByRole('textbox')).toHaveCount(0)
  await expect(row.getByRole('button', { name: quotesEn.readAgain })).toBeVisible()

  // Read again and still the same, it may be the document itself (a discount on a line): the field comes back.
  await setQuoteTotalOverride(email, projectId, null)
  await setQuoteRetries(email, projectId, 1)
  await page.reload()
  await expect(row).toContainText(`${quotesEn.misreadLines} ${quotesEn.misreadTotalAction}`)
  await expect(field).toHaveValue('')
  await field.fill('6,480')
  await row.getByRole('button', { name: quotesEn.save, exact: true }).click()
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe is the cheapest that fits: confirm 1 thing first')
  await expect(page.getByRole('region', { name: 'SolarTec Caribe' }).getByRole('note')).toContainText(quotesEn.caveatTyped)
})

test('a typed total can be changed from its ranked card, which re-ranks the quotes; a sum is refused', async ({ page }) => {
  const email = await signUp(page)
  await uploadQuotes(page, await Promise.all(['solartec', 'voltia'].map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least', { timeout: 30_000 })

  // Both totals read as 648: each quote waits for the one its lines add up to.
  await misreadQuoteTotal(email, projectId, 648)
  await page.reload()
  const card = (name: string) => page.getByRole('article').filter({ hasText: name })
  const typeTotal = async (name: string, total: string) => {
    await card(name).getByRole('textbox', { name: quotesEn.totalInQuote }).fill(total)
    await card(name).getByRole('button', { name: quotesEn.save, exact: true }).click()
  }
  await typeTotal('SolarTec Caribe', '6,480')
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe is the cheapest that fits: confirm 1 thing first')
  await typeTotal('Voltia Instalaciones', 'US$ 7,300')
  await expect(card('Voltia Instalaciones')).toContainText('$820 more than the best')

  // Changed to more than Voltia's, SolarTec's total moves Voltia to the top. A sum is not read as its digits.
  const best = page.getByRole('region', { name: 'SolarTec Caribe' })
  await best.getByRole('button', { name: quotesEn.changeTotal }).click()
  const field = best.getByRole('textbox', { name: quotesEn.totalInQuote })
  await expect(field).toBeFocused()
  await field.fill('8000 + 18%')
  await best.getByRole('button', { name: quotesEn.save, exact: true }).click()
  await expect(best.getByRole('alert')).toHaveText(quotesEn.totalInvalid)
  await field.fill('8,000')
  await best.getByRole('button', { name: quotesEn.save, exact: true }).click()
  await expect(verdictHeading(page)).toHaveText(/^Voltia Instalaciones is the cheapest that fits: confirm/)
  await expect(card('SolarTec Caribe')).toContainText('$700 more than the best')
  await expect(card('SolarTec Caribe')).toContainText(quotesEn.totalTyped)
})

test('a ranked quote whose reading needs a check can be read again from its card', async ({ page }) => {
  test.slow()
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('suna')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(page.getByText(SUNA_O2)).toBeVisible({ timeout: 30_000 })

  // The old SUNA quote after the user typed its total: it ranks as one system, so only its card can offer the retry.
  await stripQuoteOptions(email, projectId)
  await setQuoteTotalOverride(email, projectId, 6200)
  await page.reload()
  await expect(page.getByText(SUNA_O1)).toHaveCount(0)
  await page.getByRole('button', { name: quotesEn.readAgain }).click()

  await expect(page.getByText(SUNA_O1)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(SUNA_O2)).toBeVisible()
})
