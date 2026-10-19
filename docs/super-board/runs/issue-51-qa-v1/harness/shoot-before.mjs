// Before shots: the same harness built against the base commit's src (no lines table, one generic misread sentence).
// Usage: node shoot-before.mjs <clone-dir> <dist-base> <evidence-dir>
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
const [clone, dist, evidence] = process.argv.slice(2)
const { chromium } = await import(join(clone, 'node_modules/playwright-core/index.mjs'))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => { const p = new URL(req.url, 'http://x').pathname; const f = join(dist, p === '/' ? 'index.html' : p.slice(1)); try { const b = readFileSync(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' }); res.end(b) } catch { res.writeHead(404); res.end() } })
await new Promise((r) => server.listen(4193, '127.0.0.1', r))
const VIEWPORTS = [{ name: 'desktop', width: 1920, height: 1080, crop: true }, { name: 'tablet', width: 1024, height: 768, crop: true }, { name: 'mobile', width: 375, height: 667, crop: false }]
const SCENES = [
  { shot: 'before-ac1-best', scene: 'best', open: true, crop: 'section.qpanel--best > div[id]' },
  { shot: 'before-ac2-line-mismatch', scene: 'misread-lines', open: false, crop: 'article.qrow' },
  { shot: 'before-ac2-currency', scene: 'misread-currency', open: false, crop: 'article.qrow' },
]
const b = await chromium.launch(); const out = []
for (const vp of VIEWPORTS) for (const s of SCENES) {
  const page = await b.newPage({ viewport: { width: vp.width, height: vp.height } })
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://127.0.0.1:4193/?scene=${s.scene}&lang=en`); await page.waitForLoadState('networkidle')
  if (s.open) await page.getByRole('button', { name: /^Show checks/ }).click()
  await page.mouse.move(0, 0); await page.waitForTimeout(500); await page.evaluate(() => document.fonts.ready)
  const tables = await page.locator('table.qlines').count()
  const sentence = await page.locator('article.qrow p.qmeta').allTextContents()
  await page.screenshot({ path: join(evidence, `${s.shot}-${vp.name}.png`), fullPage: true })
  if (vp.crop) await page.locator(s.crop).first().screenshot({ path: join(evidence, `${s.shot}-${vp.name}-crop.png`) })
  out.push({ shot: s.shot, vp: vp.name, linesTables: tables, sentence: sentence.slice(1), errors: errors.length })
  await page.close()
}
await b.close(); server.close(); console.log(JSON.stringify(out.filter((o) => o.vp === 'desktop'), null, 1)); console.log('errors', out.reduce((a, o) => a + o.errors, 0))
