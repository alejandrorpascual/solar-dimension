import { expect, test } from '@playwright/test'
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
