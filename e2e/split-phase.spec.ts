import { expect, test, type Locator, type Page } from '@playwright/test'
import { switchLanguageOnLoad } from './header'
import { PHONE } from './phone'

type Language = 'English' | 'Español'

/** The words these tests read, as each language prints them. */
const WORDS = {
  English: {
    add: 'Add', removeOne: 'Remove one', step1: 'Step 1: Appliances', step4: 'Step 4: Your kit', inverter: 'Inverter',
    splitPhase: 'Needs a 240 V / split-phase inverter', nameplate: 'Check the nameplate for 240 V',
    names: {
      ac1i: '1 ton AC · inverter', ac1c: '1 ton AC · conventional', ac15i: '1.5 ton AC · inverter', ac15c: '1.5 ton AC · conventional',
      ac2i: '2 ton AC · inverter', ac2c: '2 ton AC · conventional', ac3i: '3 ton AC · inverter', ac3c: '3 ton AC · conventional',
      fridge: 'Refrigerator', well: 'Well pump, 1/2 HP', sump: 'Sump pump, 1/3 HP',
    },
    inverterSpec: '4,000 W continuous, not VA, pure sine, 48 V DC input', splitPhaseOutput: ', 120/240 V split-phase output',
    note: '2 ton AC · conventional usually runs on 240 V. You need a split-phase (240 V) inverter or two stacked units.',
  },
  Español: {
    add: 'Agregar', removeOne: 'Quitar un', step1: 'Paso 1: Electrodomésticos', step4: 'Paso 4: Tu kit', inverter: 'Inversor',
    splitPhase: 'Requiere un inversor de 240 V / fase partida', nameplate: 'Revisa en la placa si es de 240 V',
    names: {
      ac1i: 'Aire de 1 tonelada · inverter', ac1c: 'Aire de 1 tonelada · convencional', ac15i: 'Aire de 1.5 toneladas · inverter',
      ac15c: 'Aire de 1.5 toneladas · convencional', ac2i: 'Aire de 2 toneladas · inverter', ac2c: 'Aire de 2 toneladas · convencional',
      ac3i: 'Aire de 3 toneladas · inverter', ac3c: 'Aire de 3 toneladas · convencional',
      fridge: 'Refrigerador', well: 'Bomba de pozo, 1/2 HP', sump: 'Bomba de achique, 1/3 HP',
    },
    inverterSpec: '4,000 W continuos, no VA, onda pura, entrada 48 V CC', splitPhaseOutput: ', salida de fase partida 120/240 V',
    note: 'Aire de 2 toneladas · convencional normalmente funciona a 240 V. Necesitas un inversor de fase partida (240 V) o dos unidades acopladas.',
  },
} as const

type Words = (typeof WORDS)[Language]
type ApplianceId = keyof Words['names']

/** Air conditioners of 1.5 tons or more are usually sold for 240 V; the 3-ton ones also pass 3,000 W. */
const SPLIT_PHASE_IDS: readonly ApplianceId[] = ['ac15i', 'ac15c', 'ac2i', 'ac2c', 'ac3i', 'ac3c']
const NO_240V_IDS: readonly ApplianceId[] = ['ac1i', 'ac1c', 'fridge', 'sump']

/** The step 1 card of one appliance, found by its Add button (named for the appliance whatever title the card shows). */
const card = (page: Page, words: Words, id: ApplianceId): Locator =>
  page.locator('.card').filter({ has: page.getByRole('button', { name: `${words.add} ${words.names[id]}`, exact: true }) })

const inverterRow = (page: Page, words: Words): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: words.inverter, exact: true }) })

async function openStep1(page: Page, language: Language): Promise<void> {
  await page.goto('/?step=1')
  if (language !== 'English') await switchLanguageOnLoad(page, language)
  await expect(card(page, WORDS[language], 'ac15c')).toBeVisible()
}

for (const language of ['English', 'Español'] as const) {
  const words = WORDS[language]

  test(`1.5-ton and larger AC cards say they need 240 V and the well pump asks for a nameplate check (${language})`, PHONE, async ({ page }) => {
    await openStep1(page, language)
    // Soft, so a failing run names every card that is wrong, not only the first.
    for (const id of SPLIT_PHASE_IDS) await expect.soft(card(page, words, id), id).toContainText(words.splitPhase)
    for (const id of NO_240V_IDS) await expect.soft(card(page, words, id), id).not.toContainText('240 V')
    const well = card(page, words, 'well')
    await expect.soft(well, 'well').toContainText(words.nameplate)
    await expect.soft(well, 'well').not.toContainText(words.splitPhase)
    // The extra card line wraps inside the card: the page never scrolls sideways, on a phone either.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  })

  test(`a 2-ton AC alone gives the 240 V note and the split-phase inverter output, and removing it takes both away (${language})`, async ({ page }) => {
    await openStep1(page, language)
    const add = page.getByRole('button', { name: `${words.add} ${words.names.ac2c}`, exact: true })
    const removeOne = page.getByRole('button', { name: `${words.removeOne} ${words.names.ac2c}`, exact: true })
    // A click that lands before hydration adds nothing, so it is repeated until the card turns on.
    await expect(async () => {
      if (await add.isVisible()) await add.click()
      await expect(removeOne).toBeVisible({ timeout: 1000 })
    }).toPass()
    await page.getByRole('button', { name: words.step4, exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: words.note })).toBeVisible()
    await expect(inverterRow(page, words)).toContainText(words.inverterSpec + words.splitPhaseOutput)

    await page.getByRole('button', { name: words.step1, exact: true }).click()
    await removeOne.click()
    await expect(add).toBeVisible()
    await page.getByRole('button', { name: words.step4, exact: true }).click()
    // The default appliances alone: a 3,000 W inverter, no 240 V output and no 240 V note.
    await expect(inverterRow(page, words)).toContainText(words.inverterSpec.replace('4,000', '3,000'))
    await expect(inverterRow(page, words)).not.toContainText('120/240 V')
    await expect(page.getByText(words.note)).toHaveCount(0)
  })
}
