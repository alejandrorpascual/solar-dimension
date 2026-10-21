import { expect, test } from '@playwright/test'
import { LOCALE_COOKIE } from '../src/i18n'
import { isProjectRead, quotePdf, signUp, uploadQuotes } from './quotes'

test('a server failure reaches the page as a reference, with nothing of what went wrong', async ({ page }) => {
  await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  const dialog = page.getByRole('dialog', { name: "We've got it from here" })
  await expect(dialog).toBeVisible()

  // The verdict page's data call goes on to the server without its project id, so the server function throws on its
  // own input: an error nobody wrote for the caller, as a failed query is.
  let answer = ''
  await page.route('**/_serverFn/**', async (route) => {
    const request = route.request()
    if (request.method() !== 'GET' || !isProjectRead(request.url())) return route.fallback()
    const response = await route.fetch({ url: request.url().replace(encodeURIComponent('"projectId"'), encodeURIComponent('"projectIdx"')) })
    answer = await response.text()
    await route.fulfill({ response })
  })
  await dialog.getByRole('link', { name: 'Watch progress' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Something interrupted the kit builder.' })).toBeVisible()
  await expect(page.getByText(/^Server error\. Reference: [0-9a-f]{8}$/)).toBeVisible()
  // Neither the page nor the answer it was built from says what the server tripped on.
  expect(answer).toMatch(/Server error \(ref [0-9a-f]{8}\)/)
  for (const leak of ['projectIdx', 'invalid_type', 'expected', 'ZodError']) {
    expect(answer).not.toContain(leak)
    await expect(page.getByText(leak)).toHaveCount(0)
  }
})

test('a failure while the server renders the page is a reference too, in the page and in the HTML it arrived as', async ({ page }) => {
  await signUp(page)

  // A project id longer than the server function takes: it throws on its own input while the server renders the page,
  // so no call leaves the browser for a test to step into.
  const response = await page.goto(`/projects/${'x'.repeat(100)}/quotes`)
  const html = (await response?.text()) ?? ''

  await expect(page.getByRole('heading', { level: 1, name: 'Something interrupted the kit builder.' })).toBeVisible()
  // The HTML carries the error for the browser to take over the page with: the same reference, and nothing else of it.
  const ref = /Server error \(ref ([0-9a-f]{8})\)/.exec(html)?.[1]
  expect(ref).toBeDefined()
  await expect(page.getByText(`Server error. Reference: ${ref}`, { exact: true })).toBeVisible()
  for (const leak of ['too_big', 'Too big', 'ZodError']) {
    expect(html).not.toContain(leak)
    await expect(page.getByText(leak)).toHaveCount(0)
  }
})

/** The stylesheets an HTML page links from this site (the fonts come from Google's). */
const ownStylesheets = (html: string): string[] =>
  [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('rel="stylesheet"'))
    .map((tag) => /href="([^"]+)"/.exec(tag)?.[1] ?? '')
    .filter((href) => href.startsWith('/'))

test("the root error screen arrives inside the page shell: its HTML links the app's stylesheet", async ({ page, baseURL }) => {
  const stylesheets = ownStylesheets((await (await page.goto('/'))?.text()) ?? '')
  expect(stylesheets).not.toEqual([])

  // A language cookie that cannot be decoded fails the root route's own read while the server renders the page, so the
  // error screen stands in for the whole page, not for one route's part of it.
  await page.context().addCookies([{ name: LOCALE_COOKIE, value: '%', url: baseURL }])
  const html = (await (await page.goto('/'))?.text()) ?? ''

  await expect(page.getByRole('heading', { level: 1, name: 'Something interrupted the kit builder.' })).toBeVisible()
  expect(ownStylesheets(html)).toEqual(expect.arrayContaining(stylesheets))
})
