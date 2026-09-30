import { expect, test } from '@playwright/test'
import { cloneProject, countQuoteRows, firstProjectId, seedQuoteRows, setQuoteUploadsThisMonth } from './db'
import { openVerdictFromTray, quotePdf, signUp, tray, uploadQuotes, verdictHeading } from './quotes'

const ALL = ['solartec', 'voltia', 'grupoluz', 'enerhogar']

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
  await grupo.getByRole('group', { name: 'Battery charger', exact: true }).getByRole('button', { name: 'Included', exact: true }).click()
  await grupo.getByRole('group', { name: 'Class T fuse', exact: true }).getByRole('button', { name: 'Included', exact: true }).click()
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
  await sheet.getByRole('switch', { name: 'Battery charger', exact: true }).click()
  await sheet.getByRole('switch', { name: 'Class T fuse', exact: true }).click()
  await sheet.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(verdictHeading(page)).toHaveText('Grupo Luz fits your kit for the least')
  await page.reload()
  await expect(verdictHeading(page)).toHaveText('Grupo Luz fits your kit for the least')
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

test('a project that already has 10 quotes refuses an eleventh, with the reason', async ({ page }) => {
  const email = await signUp(page)
  await page.goto('/?step=3')
  await expect(page.getByRole('button', { name: 'Upload quotes' })).toBeEnabled({ timeout: 15_000 })
  const projectId = await firstProjectId(email)
  await seedQuoteRows(email, projectId, 10)

  await uploadQuotes(page, [await quotePdf('solartec')])
  const dialog = page.getByRole('dialog', { name: 'None of these files could be uploaded' })
  await expect(dialog).toContainText('solartec.pdf: This project already has 10 quotes.')
  expect(await countQuoteRows(email, projectId)).toBe(10)
})

test('an account that used its 20 uploads this month is refused, with the reason', async ({ page }) => {
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
