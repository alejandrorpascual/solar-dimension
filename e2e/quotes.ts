import { expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/** A real one-page PDF, so the server's page check passes; the stub picks the sample quote by file name. */
export async function quotePdf(name: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  page.drawText(`Cotización ${name}`, { x: 50, y: 700, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) })
  return { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

export async function signUp(page: Page): Promise<string> {
  const email = `e2e-quotes-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  return email
}

/** Opens the kit, waits for the project to reach the server, and picks the files through the Upload button. */
export async function uploadQuotes(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[], label = 'Upload quotes'): Promise<void> {
  await page.goto('/?step=3')
  const button = page.getByRole('button', { name: label })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  const chooser = page.waitForEvent('filechooser')
  await button.click()
  await (await chooser).setFiles(files)
}

export const tray = (page: Page) => page.getByRole('region', { name: 'Quote progress' })
export const verdictHeading = (page: Page) => page.getByRole('heading', { level: 1 })

/** Waits for the tray's "Verdict ready" and opens the verdict from it. */
export async function openVerdictFromTray(page: Page): Promise<void> {
  const link = tray(page).getByRole('link', { name: 'See verdict' })
  await expect(link).toBeVisible({ timeout: 30_000 })
  await link.click()
  await expect(verdictHeading(page)).toBeVisible()
}

/**
 * Resolves when the next must-have save, or the next confirmation of a quote's item, has answered. Changes on the
 * verdict are optimistic, so a test that reloads right after one must wait for its save, or the reload can read the
 * data before it lands.
 */
export function saved(page: Page, kind: 'musts' | 'item'): Promise<unknown> {
  return page.waitForResponse((r) => r.request().method() === 'POST' && isSave(r.request().postData() ?? '', kind))
}

/** A must-have save names the project and the item; a confirmation names the quote and the item. */
function isSave(body: string, kind: 'musts' | 'item'): boolean {
  return body.includes('"item"') && body.includes(kind === 'musts' ? '"projectId"' : '"quoteId"')
}

/** A must-have save: the only server call that sends a project id and an item. */
export const isMustSave = (body: string): boolean => isSave(body, 'musts')

/** The verdict page's data read: the only GET server call whose payload names a project. */
export const isProjectRead = (url: string): boolean => url.includes('/_serverFn/') && decodeURIComponent(url).includes('"projectId"')
