import type { Page } from '@playwright/test'

/** Picks a language from the header's globe menu; its trigger is named in the current language ("Language: …" or "Idioma: …"). */
export async function switchLanguage(page: Page, language: 'English' | 'Español'): Promise<void> {
  await page.getByRole('button', { name: /^(Language|Idioma): / }).click()
  await page.getByRole('menuitemradio', { name: language }).click()
}

/** Runs an item from the header's account menu, like "Sign out" or "Connect Google". */
export async function accountAction(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: /^Signed in as / }).click()
  await page.getByRole('menuitem', { name: item }).click()
}
