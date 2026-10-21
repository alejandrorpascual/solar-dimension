import { expect, test, type Locator } from '@playwright/test'

/**
 * WCAG 1.4.11: a field with no other cue to where it is has only its edge to show it, and the edge must stand out of
 * what is behind it by this ratio. A page mostly white on a near-white ground fails it with a hairline.
 */
const MIN_EDGE_CONTRAST = 3

type Rgb = readonly [number, number, number]

const WHITE: Rgb = [255, 255, 255]

/** A colour as the browser computes it: `rgb(r, g, b)`. One with an alpha does not say what it looks like on its own. */
function parseRgb(css: string): Rgb {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css)
  if (!match) throw new Error(`Not an opaque colour: ${css}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** WCAG 2 relative luminance: each channel linearised, then weighted by how bright the eye finds it. */
function luminance([red, green, blue]: Rgb): number {
  const linear = (channel: number) => {
    const share = channel / 255
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter! + 0.05) / (darker! + 0.05)
}

/** What a field draws its edge with, and the page's ground, which a field's edge also sits against beside the field. */
async function edgeAndGround(field: Locator): Promise<{ edge: Rgb; ground: Rgb }> {
  const css = await field.evaluate((el) => ({
    edge: getComputedStyle(el).borderTopColor,
    ground: getComputedStyle(document.body).backgroundColor,
  }))
  return { edge: parseRgb(css.edge), ground: parseRgb(css.ground) }
}

async function expectEdgeToShow(field: Locator): Promise<void> {
  const { edge, ground } = await edgeAndGround(field)
  expect.soft(contrast(edge, WHITE), 'edge against white').toBeGreaterThanOrEqual(MIN_EDGE_CONTRAST)
  expect.soft(contrast(edge, ground), 'edge against the ground').toBeGreaterThanOrEqual(MIN_EDGE_CONTRAST)
}

test('the edge of a text field shows against white and against the ground', async ({ page }) => {
  await page.goto('/')
  const search = page.getByLabel('Search appliances')
  await expect(search).toBeVisible()
  await expectEdgeToShow(search)
})

test('the edge of the duty picker, a select, shows against white and against the ground', async ({ page }) => {
  await page.goto('/')
  const picker = page.getByLabel('Refrigerator: share of each hour it runs')
  await expect(picker).toBeVisible()
  await expectEdgeToShow(picker)
})

test('the edge a quantity field draws when the pointer is over it shows against white and against the ground', async ({ page }) => {
  await page.goto('/')
  const quantity = page.getByLabel('Quantity of Refrigerator')
  await expect(quantity).toBeVisible()
  await quantity.hover()
  await expectEdgeToShow(quantity)
})
