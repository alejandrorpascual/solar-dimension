// Serves the harness bundle and screenshots each scene at the three QA viewports.
// Usage: node shoot.mjs <clone-dir> <evidence-dir>
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [clone, evidence] = process.argv.slice(2)
if (!clone || !evidence) throw new Error('usage: node shoot.mjs <clone-dir> <evidence-dir>')
const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, 'dist')
const { chromium } = await import(join(clone, 'node_modules/playwright-core/index.mjs'))

const PORT = 4190
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  const file = join(dist, path === '/' ? 'index.html' : path.slice(1))
  try {
    const body = readFileSync(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080, crop: true },
  { name: 'tablet', width: 1024, height: 768, crop: true },
  { name: 'mobile', width: 375, height: 667, crop: false },
]
const SCENES = [
  { shot: 'ac1-best-lines', scene: 'best', lang: 'en', crop: 'table.qlines' },
  { shot: 'ac2-line-mismatch', scene: 'misread-lines', lang: 'en', crop: 'article.qrow' },
  { shot: 'ac2-currency', scene: 'misread-currency', lang: 'en', crop: 'article.qrow' },
  { shot: 'ac2-currency-es', scene: 'misread-currency', lang: 'es', crop: 'article.qrow' },
  { shot: 'ac3-stored-reading', scene: 'stored', lang: 'en', crop: 'article.qrow' },
]

mkdirSync(evidence, { recursive: true })
const browser = await chromium.launch()
const results = []
for (const vp of VIEWPORTS) {
  for (const s of SCENES) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://127.0.0.1:${PORT}/?scene=${s.scene}&lang=${s.lang}`)
    await page.waitForLoadState('networkidle')
    const toggle = page.getByRole('button', { name: /^(Show checks|Ver comprobaciones)/ })
    await toggle.click()
    const table = page.locator('table.qlines')
    await table.waitFor()
    await page.mouse.move(0, 0)
    // Let the toggle's chevron finish turning before the shot.
    await page.waitForTimeout(500)
    const rows = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)))
    const caption = await table.locator('caption').textContent()
    const card = page.locator('article.qrow')
    const sentence = (await card.count()) > 0 ? await card.locator('p.qmeta').allTextContents() : []
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const reason = await page.evaluate(() => document.body.dataset.reason ?? null)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(evidence, `${s.shot}-${vp.name}.png`), fullPage: true })
    if (vp.crop) await page.locator(s.crop).first().screenshot({ path: join(evidence, `${s.shot}-${vp.name}-crop.png`) })
    results.push({ shot: s.shot, viewport: vp.name, width: vp.width, lang: s.lang, reason, caption, rows, sentence, scrollWidth, consoleErrors: errors })
    await page.close()
  }
}
await browser.close()
server.close()
writeFileSync(join(evidence, 'harness-results.json'), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results.map((r) => ({ shot: r.shot, vp: r.viewport, reason: r.reason, rows: r.rows.length, overflow: r.scrollWidth > r.width, errors: r.consoleErrors.length }))))
