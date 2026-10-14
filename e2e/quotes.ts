import { expect, type FileChooser, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { firstProjectId, markEmailVerified } from './db'

/** How long one click waits for the file picker before the next try. */
const CHOOSER_WAIT_MS = 3_000

/** A real one-page PDF, so the server's page check passes; the stub picks the sample quote by file name. */
export async function quotePdf(name: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  page.drawText(`Cotización ${name}`, { x: 50, y: 700, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) })
  return { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }
}

/**
 * Signs up a new email/password account. Only a verified account may start quote reads, and sign-up never verifies,
 * so the account is marked verified in the database unless a test needs it unverified. The server reads the flag from
 * the user row, so the next page load picks it up.
 */
export async function signUp(page: Page, { verified = true }: { verified?: boolean } = {}): Promise<string> {
  const email = `e2e-quotes-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto('/login')
  await page.getByRole('button', { name: 'No account yet? Create one' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: `Signed in as ${email}` })).toBeVisible()
  if (verified) await markEmailVerified(email)
  return email
}

/** Signs up, waits for the default project to reach the server, and returns its id. */
export async function signUpWithProject(page: Page): Promise<{ email: string; projectId: string }> {
  const email = await signUp(page)
  await page.goto('/?step=4')
  await expect(page.getByRole('button', { name: 'Upload quotes' })).toBeEnabled({ timeout: 15_000 })
  return { email, projectId: await firstProjectId(email) }
}

/**
 * Opens the kit, waits for the project to reach the server, and picks the files through the Upload button. `origin`
 * picks another E2E server than the main one (the session cookie is shared across localhost ports).
 */
export async function uploadQuotes(
  page: Page, files: { name: string; mimeType: string; buffer: Buffer }[], label = 'Upload quotes', origin = '',
): Promise<void> {
  await page.goto(`${origin}/?step=4`)
  await pickQuoteFiles(page, files, label)
}

/** Picks the files through the Upload button of the page as it is, without loading it again. */
export async function pickQuoteFiles(
  page: Page, files: { name: string; mimeType: string; buffer: Buffer }[], label = 'Upload quotes',
): Promise<void> {
  const button = page.getByRole('button', { name: label })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  // The server-rendered button is enabled before the page hydrates, and a click before then opens nothing: click again
  // until the picker opens.
  let chooser: FileChooser | null = null
  await expect(async () => {
    const next = page.waitForEvent('filechooser', { timeout: CHOOSER_WAIT_MS })
    await button.click()
    chooser = await next
  }).toPass({ timeout: 30_000 })
  await chooser!.setFiles(files)
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

/**
 * The address and accept header of the page's next upload call, which is stopped before it reaches the server. Server
 * function addresses are the same for every account, so a test can send the call again as another user.
 */
export async function captureUploadCall(page: Page): Promise<{ url: string; accept: string }> {
  return new Promise((resolve, reject) => {
    page.route('**/_serverFn/**', async (route) => {
      const request = route.request()
      if (request.method() !== 'POST' || !(request.headers()['content-type'] ?? '').includes('multipart/form-data')) return route.continue()
      resolve({ url: request.url(), accept: (await request.allHeaders()).accept ?? '*/*' })
      await route.abort()
    }).catch(reject)
  })
}

/** Sends an upload call as the page's signed-in user, from the page's own origin, as the page itself would. */
export async function postUpload(page: Page, call: { url: string; accept: string }, projectId: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  return page.request.post(call.url, {
    headers: { accept: call.accept, 'x-tsr-serverfn': 'true', origin: new URL(page.url()).origin },
    multipart: { projectId, file },
  })
}

export interface CapturedCall { url: string; headers: Record<string, string>; body: string }

/** The page's next retry call for `quoteId`, stopped before it reaches the server, so a test can send it again. */
export async function captureRetryCall(page: Page, quoteId: string): Promise<CapturedCall> {
  return new Promise((resolve, reject) => {
    page.route('**/_serverFn/**', async (route) => {
      const request = route.request()
      const body = request.postData() ?? ''
      if (request.method() !== 'POST' || !body.includes(quoteId)) return route.continue()
      const all = await request.allHeaders()
      resolve({ url: request.url(), headers: { 'content-type': all['content-type'] ?? 'application/json', accept: all.accept ?? '*/*' }, body })
      await route.abort()
    }).catch(reject)
  })
}

/** Sends a captured retry call for another quote, as the page would: from its own origin, as a server function call. */
export async function postRetry(page: Page, call: CapturedCall, fromId: string, toId: string) {
  return page.request.post(call.url, {
    headers: { ...call.headers, 'x-tsr-serverfn': 'true', origin: new URL(page.url()).origin },
    data: call.body.replaceAll(fromId, toId),
  })
}
