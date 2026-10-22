import { expect, test } from '@playwright/test'

const SUPPORT_EMAIL = 'alexandros2707@gmail.com'

const LANGUAGES = [
  {
    name: 'English', locale: 'en-US',
    toSignUp: 'No account yet? Create one', toSignIn: 'Already have an account? Sign in',
    recovery: 'Forgot your password?', quotes: 'Uploading quotes needs a Google account.',
  },
  {
    name: 'Spanish', locale: 'es-VE',
    toSignUp: '¿No tienes cuenta? Crea una', toSignIn: '¿Ya tienes cuenta? Inicia sesión',
    recovery: '¿Olvidaste tu contraseña?', quotes: 'Subir cotizaciones requiere una cuenta de Google.',
  },
]

for (const lang of LANGUAGES) {
  test.describe(`the sign-in page in ${lang.name}`, () => {
    test.use({ locale: lang.locale })

    test('sign-in says how to recover access, with the support address as a link, and holds back the quotes note', async ({ page }) => {
      await page.goto('/login')
      await expect(page.getByText(lang.recovery)).toBeVisible()
      await expect(page.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`)
      await expect(page.getByText(lang.quotes)).toHaveCount(0)
    })

    test('sign-up says quotes need a Google account, and holds back the recovery line', async ({ page }) => {
      await page.goto('/login')
      // A click that lands before the page hydrates does nothing; click until the sign-up form shows, never twice.
      const toSignIn = page.getByRole('button', { name: lang.toSignIn })
      await expect(async () => {
        if (!(await toSignIn.isVisible())) await page.getByRole('button', { name: lang.toSignUp }).click()
        await expect(toSignIn).toBeVisible({ timeout: 1000 })
      }).toPass()
      await expect(page.getByText(lang.quotes)).toBeVisible()
      await expect(page.getByText(lang.recovery)).toHaveCount(0)
      await expect(page.getByRole('link', { name: SUPPORT_EMAIL })).toHaveCount(0)
    })
  })
}
