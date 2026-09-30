import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { quotesEn } from '../src/i18n/quotes-en'
import {
  cloneProject, countQuoteRows, firstProjectId, linkGoogleAccount, quoteFiles, quoteRetryStates, seedQuoteRows, setQuoteRetries, setQuoteUploadsThisMonth,
  trashedPaths,
} from './db'
import { captureGoogleRedirect, expectOurGoogleRequest } from './google'
import { hideProjects, showProjects } from './projects'
import {
  captureUploadCall, isMustSave, isProjectRead, openVerdictFromTray, postUpload, quotePdf, saved, signUp, tray, uploadQuotes, verdictHeading,
} from './quotes'

const ALL = ['solartec', 'voltia', 'grupoluz', 'enerhogar']
/** Where the E2E server keeps quote files (QUOTES_LOCAL_DIR in playwright.config.ts). */
const QUOTE_FILES_DIR = '.data/e2e-quotes'

test('quotes upload, are read in the background, and end in a verdict', async ({ page }) => {
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
  await expect(page.getByRole('img', { name: /SolarTec Caribe, \$6,480, Best fit/ })).toBeVisible()
  await expect(tray(page)).toBeHidden()
})

test('must-haves and confirmations change the winner, and stick', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, await Promise.all(ALL.map(quotePdf)))
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await openVerdictFromTray(page)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')

  const grupo = page.getByRole('article').filter({ hasText: 'Grupo Luz' })
  await grupo.getByRole('button', { name: 'Show every check for Grupo Luz', exact: true }).click()
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
  await best.getByRole('button', { name: 'Show every check for Grupo Luz', exact: true }).click()
  await best.getByRole('group', { name: 'Battery charger', exact: true }).getByRole('button', { name: 'Included', exact: true }).click()
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least')
  const row = page.getByRole('article').filter({ hasText: 'Grupo Luz' })
  await row.getByRole('button', { name: 'Show every check for Grupo Luz', exact: true }).click()
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

  // Adding a quote reloads the page once while it is read; the must-have is changed after that reload.
  const addedReload = page.waitForResponse((r) => r.request().method() === 'GET' && isProjectRead(r.url()))
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add another quote' }).click()
  await (await chooser).setFiles([await quotePdf('voltia')])
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

test('a file of the wrong type is refused before upload, with the reason', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }])
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog).toContainText('notes.txt: Only PDF, JPG, PNG or WebP files can be read.')
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
  await signUp(stranger)
  expect((await stranger.request.get(href!)).status()).toBe(404)
  // Both accounts have a default project with the same id, so the same address shows the stranger their own, empty
  // verdict: none of the owner's quotes. A project that exists only for the owner is a real 404.
  await stranger.goto(verdictUrl)
  await expect(stranger.getByRole('heading', { name: 'No quotes yet' })).toBeVisible()
  await expect(stranger.getByText('SolarTec')).toHaveCount(0)
  const privateId = `e2e-private-${Date.now()}`
  await cloneProject(email, privateId)
  await stranger.goto(`/projects/${privateId}/quotes`)
  await expect(stranger.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await other.close()
})

test('a quote that could not be read can be retried, until its retries are used up, on the page and on the server', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  // The stub reads only the sample quotes; any other file name fails on both models.
  await uploadQuotes(page, [await quotePdf('unreadable')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)

  const row = page.getByRole('article').filter({ hasText: 'unreadable.pdf' })
  const failed = row.getByText("Couldn't read it", { exact: true })
  await expect(failed).toBeVisible({ timeout: 30_000 })
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
  const email = await signUp(page)
  await page.goto('/?step=3')
  await expect(page.getByRole('button', { name: 'Upload quotes' })).toBeEnabled({ timeout: 15_000 })
  const projectId = await firstProjectId(email)
  await seedQuoteRows(email, projectId, 10)

  // Once the project has quotes, the card's button reads "Add quotes". The page may learn of the seeded rows at any
  // moment, so the upload reloads the kit and goes through that label, which no longer changes.
  await uploadQuotes(page, [await quotePdf('solartec')], quotesEn.cardAddMore)
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog).toContainText('solartec.pdf: This project already has 10 quotes.')
  expect(await countQuoteRows(email, projectId)).toBe(10)
})

test('an account that used its 20 uploads this month is refused, with the reason', async ({ page }) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  await page.goto('/?step=3')
  await expect(page.getByRole('button', { name: 'Upload quotes' })).toBeEnabled({ timeout: 15_000 })
  const projectId = await firstProjectId(email)
  await setQuoteUploadsThisMonth(email, 20)

  await uploadQuotes(page, [await quotePdf('solartec')])
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog).toContainText("solartec.pdf: You've uploaded 20 quotes this month. The limit resets on the 1st.")
  expect(await countQuoteRows(email, projectId)).toBe(0)
})

test('deleting a project removes its quotes and their files', async ({ page }) => {
  const email = await signUp(page)
  await page.goto('/')
  await showProjects(page)
  await page.getByRole('button', { name: '+ New project' }).click()
  await hideProjects(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  await expect.poll(async () => (await quoteFiles(email)).length).toBe(1)
  const [quote] = await quoteFiles(email)
  const file = path.resolve(QUOTE_FILES_DIR, quote!.path)
  expect(existsSync(file)).toBe(true)

  await page.goto('/')
  const removed = page.waitForResponse((r) => r.request().method() === 'POST' && (r.request().postData() ?? '').includes('"ids"'))
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  expect((await removed).ok()).toBe(true)
  expect(await countQuoteRows(email, quote!.projectId)).toBe(0)
  expect(existsSync(file)).toBe(false)
  // The file was trashed with the rows and removed right away, so nothing is left for the sweep.
  expect(await trashedPaths([quote!.path])).toEqual([])
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
  await page.goto('/?step=3')
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
  await page.goto('/?step=3')
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
})

test('a password account with a Google account whose token verifies its email can upload, though its email was never marked verified', async ({ page }) => {
  // Sign-up and database writes over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page, { verified: false })
  await linkGoogleAccount(email)
  await page.goto('/?step=3')
  await expect(page.getByRole('button', { name: 'Upload quotes', exact: true })).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Connect Google to upload quotes' })).toHaveCount(0)
})

test('a Google account whose email Google did not verify does not unlock uploads', async ({ page }) => {
  // Sign-up and database writes over Neon's HTTP driver can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page, { verified: false })
  await linkGoogleAccount(email, { emailVerified: false })
  await page.goto('/?step=3')
  const card = page.getByRole('region', { name: 'Got quotes from installers?' })
  await expect(card).toContainText('Uploading quotes needs a verified account.')
  await expect(page.getByRole('button', { name: 'Upload quotes', exact: true })).toHaveCount(0)
})
