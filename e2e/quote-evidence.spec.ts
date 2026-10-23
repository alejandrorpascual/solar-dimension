import { expect, test } from '@playwright/test'
import { firstProjectId, splitQuoteBattery, type BatteryLine } from './db'
import { switchLanguage } from './header'
import { PHONE } from './phone'
import { quotePdf, signUp, uploadQuotes, verdictHeading } from './quotes'

/** SolarTec's eight 5.12 kWh units, rewritten as two lines on two pages: four of them, and two 2.4 kWh units. */
const TWO_BANKS: readonly [BatteryLine, BatteryLine] = [
  { qty: 4, kWh: 5.12, page: 1, text: 'Batería LiFePO4 5.12 kWh × 4' },
  { qty: 2, kWh: 2.4, page: 2, text: 'Batería LiFePO4 2.4 kWh × 2' },
]

test('a check quotes every line it read and shows its arithmetic, in English and Spanish (AI-18)', PHONE, async ({ page }, testInfo) => {
  // Seeds the database over Neon's HTTP driver on top of sign-up and an upload, which can pass 30 s on a slow CI runner.
  test.slow()
  const email = await signUp(page)
  await uploadQuotes(page, [await quotePdf('solartec')])
  await page.getByRole('button', { name: 'Ok, got it' }).click()
  const projectId = await firstProjectId(email)
  await page.goto(`/projects/${projectId}/quotes`)
  await expect(verdictHeading(page)).toHaveText('SolarTec Caribe fits your kit for the least', { timeout: 30_000 })

  const best = page.getByRole('region', { name: 'SolarTec Caribe' })
  const check = (name: string) => best.getByRole('listitem').filter({ hasText: name })
  /** The quote boxes under a check: each opens with the quote's own words in quotation marks. */
  const quoted = (name: string) => check(name).getByText(/^“/)
  await best.getByRole('button', { name: 'Show checks for SolarTec Caribe', exact: true }).click()
  await expect(check('Battery bank')).toContainText('8 × 5.12 kWh × 85% depth of discharge')
  await expect(quoted('Battery bank')).toHaveText(['“Batería LiFePO4 5.12 kWh × 8” · Page 1'])
  await expect(best.getByText('12.0 kW running · 24.0 kW surge rating', { exact: true })).toBeVisible()
  // The cable check quotes the one line that decides it, the thickest.
  await expect(quoted('Main cables')).toHaveText(['“Cable 4/0 AWG, 2 tramos” · Page 1'])

  await splitQuoteBattery(email, projectId, TWO_BANKS)
  await page.reload()
  await best.getByRole('button', { name: 'Show checks for SolarTec Caribe', exact: true }).click()
  await expect(quoted('Battery bank')).toHaveText(['“Batería LiFePO4 5.12 kWh × 4” · Page 1', '“Batería LiFePO4 2.4 kWh × 2” · Page 2'])
  await expect(check('Battery bank')).toContainText('(4 × 5.12 kWh + 2 × 2.4 kWh) × 85% depth of discharge')
  // A phone widens its layout viewport to fit wider content, so the page is measured against the device's own width.
  const deviceWidth = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(deviceWidth)
  await best.screenshot({ path: testInfo.outputPath(`evidence-${testInfo.project.name}-en.png`) })

  await switchLanguage(page, 'Español')
  await expect(best.getByRole('button', { name: 'Ocultar comprobaciones de SolarTec Caribe', exact: true })).toBeVisible()
  await expect(best.getByText('(4 × 5.12 kWh + 2 × 2.4 kWh) × 85 % de descarga', { exact: true })).toBeVisible()
  await expect(best.getByText('“Batería LiFePO4 2.4 kWh × 2” · Página 2', { exact: true })).toBeVisible()
  await expect(best.getByText('12.0 kW en marcha · 24.0 kW de potencia pico', { exact: true })).toBeVisible()
  await best.screenshot({ path: testInfo.outputPath(`evidence-${testInfo.project.name}-es.png`) })
})
