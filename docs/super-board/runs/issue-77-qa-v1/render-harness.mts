// QA harness for issue #77: renders the real step 3 and kit components (server-side, with the app's CSS) for each AC
// scenario, checks the visible text, and screenshots them at the three standard viewports.
// Usage: npx tsx docs/super-board/runs/issue-77-qa-v1/render-harness.mts "$PWD" <new output dir>
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.argv[2]!
const OUT = process.argv[3]!
const req = createRequire(join(ROOT, 'package.json'))
const load = async (spec: string) => import(pathToFileURL(req.resolve(spec)).href)

const STUB = '\0qa-root-data'
const vite = await load('vite')
const server = await vite.createServer({
  root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  esbuild: { jsx: 'automatic' },
  plugins: [{
    name: 'qa-root-data', enforce: 'pre',
    resolveId: (source: string) => (/\/useRootData(\.ts)?$/.test(source) ? STUB : null),
    load: (id: string) => id === STUB
      ? 'export function useRootData(){ return { locale: globalThis.__QA_LOCALE ?? "en", user: null, googleEnabled: false, catalog: [], quotePollMs: 3000 } }'
      : null,
  }],
})
const m = (p: string) => server.ssrLoadModule(p)
const { renderToStaticMarkup } = await load('react-dom/server')
const { createElement: h } = await load('react')
const { SolarStep } = await m('/src/components/solar/SolarStep.tsx')
const { KitSummary } = await m('/src/components/KitSummary.tsx')
const store = await m('/src/lib/store.ts')
const { computeProject } = await m('/src/lib/project-summary.ts')
const { CATALOG_SNAPSHOT } = await m('/src/lib/catalog-snapshot.ts')
const { getDictionary } = await m('/src/i18n/index.ts')

// The app's stylesheet with its @imports inlined, so the page needs no server.
const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')
  .replace(/@import '\.\/(styles\/[a-z]+\.css)';/g, (_: string, p: string) => readFileSync(join(ROOT, 'src', p), 'utf8'))
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap'

type Scenario = { name: string; locale: 'en' | 'es'; edit: (s: any, id: string) => any; kit?: boolean }
const on = (s: any, id: string) => store.setSolarIn(s, id, true)
const scenarios: Scenario[] = [
  { name: 'ac1-recommended', locale: 'en', edit: on },
  { name: 'ac1-agm-recommended', locale: 'en', edit: (s, id) => on(store.patchCurrent(s, { chemistry: 'agm', volts: 12 }), id) },
  { name: 'ac1-agm-roof-warning', locale: 'en', edit: (s, id) => store.withSolarRoof(on(store.patchCurrent(s, { chemistry: 'agm', volts: 12 }), id), id, 10), kit: true },
  { name: 'ac1-roof-warning', locale: 'en', edit: (s, id) => store.withSolarRoof(on(s, id), id, 10), kit: true },
  { name: 'ac2-help-coverage-en', locale: 'en', edit: on },
  { name: 'ac2-help-coverage-es', locale: 'es', edit: on },
  { name: 'ac4-tapped-zero', locale: 'en', edit: (s, id) => store.withSolarPanels(store.withSolarRoof(on(s, id), id, 10), id, 0), kit: true },
  { name: 'ac4-one-panel', locale: 'en', edit: (s, id) => store.withSolarRoof(on(store.patchCurrent(s, { volts: 24 }), id), id, 5) },
]

const seed = store.initialStore()
const seedId = store.currentProject(seed).id

const results: Record<string, unknown> = {}
const pages: string[] = []
for (const sc of scenarios) {
  ;(globalThis as any).__QA_LOCALE = sc.locale
  const t = getDictionary(sc.locale)
  const s = sc.edit(seed, seedId)
  const project = store.currentProject(s)
  const result = computeProject(project, CATALOG_SNAPSHOT)
  const step = renderToStaticMarkup(h(SolarStep, { store: s, commit: () => {}, project, result }))
  const kit = sc.kit
    ? renderToStaticMarkup(h(KitSummary, { result, baseline: null, projectName: project.name, quickEdit: null, onBatteryUnit: () => {} }))
    : ''
  const html = `<!doctype html><html lang="${sc.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${FONTS}"><style>${css}</style><title>${sc.name}</title></head>
<body><div class="workspace"><main class="page"><section class="stage" data-qa="step3"><h2>${t.ui.q3}</h2>${step}</section>
${kit ? `<section class="stage" data-qa="kit">${kit}</section>` : ''}</main></div></body></html>`
  const file = join(OUT, 'html', `${sc.name}.html`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
  pages.push(file)
  results[sc.name] = {
    locale: sc.locale, volts: project.volts, chemistry: project.chemistry, hours: project.hours, bankWh: result.battery?.bankWh,
    solar: project.solar, need: result.solar?.need, recommended: result.solar?.recommended, panels: result.solar?.panels,
    arrayW: result.solar?.arrayW, coverRatio: result.solar?.coverRatio,
    roofWarnings: result.warnings.filter((w: any) => w.code === 'roofLimited' || w.code === 'stringTooShort'),
  }
}
await server.close()

// Screenshots and visible-text checks in a real browser.
const pw = await load('playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const browser = await chromium.launch()
const VIEWPORTS = { desktop: { width: 1920, height: 1080 }, tablet: { width: 1024, height: 768 }, mobile: { width: 375, height: 667 } } as const
const CROPS: Record<string, string> = {
  'ac1-recommended': '.planner__count', 'ac1-agm-recommended': '.planner__count', 'ac1-agm-roof-warning': '.kit .warn', 'ac1-roof-warning': '.kit .warn',
  'ac2-help-coverage-en': '.cover', 'ac2-help-coverage-es': '.cover', 'ac4-tapped-zero': '.planner__count', 'ac4-one-panel': '.planner__count',
}
const checks: Record<string, Record<string, unknown>> = {}
for (const file of pages) {
  const name = file.split('/').pop()!.replace('.html', '')
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage({ viewport: size })
    await page.goto(pathToFileURL(file).href)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(OUT, `${name}-${vp}.png`), fullPage: true })
    if (vp !== 'mobile') await page.locator(CROPS[name]!).first().screenshot({ path: join(OUT, `${name}-${vp}-crop.png`) })
    if (vp === 'desktop' || vp === 'mobile') {
      const pct = page.locator('.cover__pct')
      const head = page.locator('.cover__head strong')
      const overlap = vp === 'mobile' && (await head.count())
        ? await page.evaluate(() => {
          const a = document.querySelector('.cover__head strong')!.getBoundingClientRect()
          const b = document.querySelector('.cover__pct')!.getBoundingClientRect()
          return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
        })
        : null
      checks[`${name}/${vp}`] = {
        help: await page.locator('.solar > p.muted').first().textContent(),
        coverHead: (await head.count()) ? await head.textContent() : null,
        coverPct: (await pct.count()) ? await pct.textContent() : null,
        panelsLine: await page.locator('.planner__big').first().textContent().catch(() => null),
        sun: await page.locator('.planner__sun-value').first().textContent().catch(() => null),
        pill: await page.locator('.planner__pill, .planner__count .chip').first().textContent().catch(() => null),
        roofNote: (await page.getByText(/Your roof holds|En tu techo caben/).count()) > 0
          ? await page.getByText(/Your roof holds|En tu techo caben/).first().textContent() : null,
        coverHeadOverlapsPct: overlap,
      }
    }
    await page.close()
  }
}
await browser.close()
writeFileSync(join(OUT, 'scenarios.json'), `${JSON.stringify({ results, checks }, null, 2)}\n`)
console.log(JSON.stringify(checks, null, 1))
