// Renders the harness bundles in headless Chromium with the app's built CSS and Google Fonts, then saves
// screenshots and sheet page measurements. Usage: node capture.mjs <checkout> <evidence dir>
import { createRequire } from 'node:module'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [checkout, outDir] = process.argv.slice(2)
if (!checkout || !outDir) throw new Error('usage: node capture.mjs <checkout> <evidence dir>')
const require = createRequire(path.join(checkout, 'package.json'))
const { chromium } = require('@playwright/test')
const here = path.dirname(new URL(import.meta.url).pathname)
const buildDir = path.join(checkout, '.output/public/_build')
const cssFiles = (await readdir(buildDir)).filter((f) => f.endsWith('.css'))
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap'
const ORIGIN = 'http://harness.test'

const VIEWPORTS = { desktop: { width: 1920, height: 1080 }, tablet: { width: 1024, height: 768 }, mobile: { width: 375, height: 667 } }
const AGM12 = { volts: 12, chemistry: 'agm' }
const NO_APPLIANCES = { appliances: false }

const html = (bundle, cfg) => `<!doctype html><html lang="${cfg.locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${FONTS}">
${cssFiles.map((f) => `<link rel="stylesheet" href="${ORIGIN}/_build/${f}">`).join('\n')}
<script>window.__cfg = ${JSON.stringify(cfg)}</script></head>
<body><div id="root"></div><script src="${ORIGIN}/${bundle}.js"></script></body></html>`

async function open(browser, bundle, cfg, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html(bundle, cfg) })
    if (url.pathname.startsWith('/_build/')) return route.fulfill({ contentType: 'text/css', body: await readFile(path.join(buildDir, path.basename(url.pathname))) })
    if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(here, 'out', path.basename(url.pathname))) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto(`${ORIGIN}/`)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => document.getElementById('root')?.children.length > 0)
  return { context, page, errors }
}

const results = {}

async function kitShot(browser, name, bundle, cfg, viewport, crops) {
  const { context, page, errors } = await open(browser, bundle, { view: 'kit', include: {}, project: {}, ...cfg }, viewport)
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })
  for (const [suffix, selector] of crops) await page.locator(selector).first().screenshot({ path: path.join(outDir, `${name}-${suffix}-crop.png`) })
  const text = await page.evaluate(() => ({
    inverterRow: [...document.querySelectorAll('tr.part')].find((r) => /Inverter|Inversor/.test(r.querySelector('th')?.textContent ?? ''))?.innerText ?? null,
    batteriesRow: [...document.querySelectorAll('tr.part')].find((r) => /Batter|Bater/.test(r.querySelector('th')?.textContent ?? ''))?.innerText ?? null,
    checks: document.querySelector('.checks')?.innerText ?? null,
    fine: document.querySelector('p.fine')?.innerText ?? null,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  }))
  results[name] = { ...text, errors }
  await context.close()
}

async function sheetShot(browser, name, bundle, cfg) {
  const { context, page, errors } = await open(browser, bundle, { view: 'sheet', project: {}, ...cfg }, { width: 900, height: 1200 })
  const m = await page.evaluate(() => window.__pages())
  // Mark each A4 page edge on the sheet, so the shot shows where the PDF cuts it.
  await page.evaluate((pageHeight) => {
    const node = document.querySelector('.ksheet')
    node.style.position = 'relative'
    for (let y = pageHeight; y < node.offsetHeight; y += pageHeight) {
      const line = document.createElement('div')
      line.style.cssText = `position:absolute;left:0;right:0;top:${y}px;border-top:2px dashed #d00;pointer-events:none`
      const tag = document.createElement('span')
      tag.textContent = `A4 page edge · ${Math.round(y)} px`
      tag.style.cssText = 'position:absolute;right:4px;top:2px;font:600 11px sans-serif;color:#d00;background:#fff'
      line.append(tag)
      node.append(line)
    }
  }, m.pageHeight)
  await page.locator('.ksheet').screenshot({ path: path.join(outDir, `${name}.png`) })
  results[name] = { pages: m.pages.length, pageHeight: m.pageHeight, sheetHeight: m.sheetHeight, footHeight: m.footHeight, slices: m.pages, errors }
  await context.close()
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
try {
  const crops = [['parts', '.parts'], ['checks', '.checks'], ['fine', 'p.fine']]
  for (const [bundle, label] of [['staging', 'before'], ['branch', 'after']]) {
    await kitShot(browser, `${label}-kit-en-desktop`, bundle, { locale: 'en' }, VIEWPORTS.desktop, crops)
    await kitShot(browser, `${label}-kit-en-tablet`, bundle, { locale: 'en' }, VIEWPORTS.tablet, crops)
    await kitShot(browser, `${label}-kit-en-mobile`, bundle, { locale: 'en' }, VIEWPORTS.mobile, [])
  }
  await kitShot(browser, 'after-kit-es-desktop', 'branch', { locale: 'es' }, VIEWPORTS.desktop, crops)
  await kitShot(browser, 'after-kit-es-tablet', 'branch', { locale: 'es' }, VIEWPORTS.tablet, [['checks', '.checks'], ['fine', 'p.fine']])
  await kitShot(browser, 'after-kit-es-mobile', 'branch', { locale: 'es' }, VIEWPORTS.mobile, [])
  await kitShot(browser, 'after-agm12-en-desktop', 'branch', { locale: 'en', project: AGM12 }, VIEWPORTS.desktop, [['checks', '.checks'], ['fine', 'p.fine']])
  for (const locale of ['en', 'es']) {
    for (const [bundle, label] of [['staging', 'before'], ['branch', 'after']]) {
      await sheetShot(browser, `${label}-sheet-no-appliances-${locale}`, bundle, { locale, include: NO_APPLIANCES })
      await sheetShot(browser, `${label}-sheet-default-${locale}`, bundle, { locale, include: {} })
    }
  }
} finally {
  await browser.close()
}
await writeFile(path.join(outDir, 'harness-measurements.json'), `{\n${Object.entries(results).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`)
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.pages ?? (v.errors.length ? v.errors : 'ok')]))))
