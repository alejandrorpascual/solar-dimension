import { expect, type Page } from '@playwright/test'

/** The dummy client id playwright.config.ts gives the E2E servers, so the Google button shows. */
export const GOOGLE_TEST_CLIENT_ID = 'e2e-google-client-id'

/** Stop the browser at Google's sign-in page and hand back the URL it was sent to. */
export async function captureGoogleRedirect(page: Page): Promise<() => URL | null> {
  let captured: URL | null = null
  await page.route('https://accounts.google.com/**', (route) => {
    captured = new URL(route.request().url())
    return route.abort()
  })
  return () => captured
}

export function expectOurGoogleRequest(url: URL | null, baseURL: string) {
  expect(url?.searchParams.get('client_id')).toBe(GOOGLE_TEST_CLIENT_ID)
  expect(url?.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google`)
  expect(url?.searchParams.get('prompt')).toBe('select_account')
}
