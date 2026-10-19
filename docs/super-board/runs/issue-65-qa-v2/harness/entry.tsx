// QA harness for issue 65 v2: renders the app's own KitSheet and KitSummary with the app's CSS, no server, no DB.
// Lives in the scratchpad, never in the repo. The clone's src is aliased as "@app".
import { createRoot } from 'react-dom/client'
import { getDictionary, tr, type Locale } from '@app/i18n'
import { CATALOG_SNAPSHOT } from '@app/lib/catalog-snapshot'
import { buildParts } from '@app/lib/kit-parts'
import { initialStore } from '@app/lib/store'
import { computeProject } from '@app/lib/project-summary'
import { KitSheet, type ExportInclude } from '@app/components/KitSheet'
import { KitSummary } from '@app/components/KitSummary'
import { printPages } from '@app/client/export-file'

interface Cfg {
  view: 'sheet' | 'kit'
  locale: Locale
  include: Partial<ExportInclude>
  project: Record<string, unknown>
}

const EVERYTHING: ExportInclude = { summary: true, appliances: true, parts: true, checks: true, notes: true, requester: true }
const cfg = (window as unknown as { __cfg: Cfg }).__cfg
const t = getDictionary(cfg.locale)
const seed = initialStore().projects[0]!
const project = { ...seed, ...cfg.project } as typeof seed
const result = computeProject(project, CATALOG_SNAPSHOT)
const root = createRoot(document.getElementById('root')!)

if (cfg.view === 'sheet') {
  root.render(
    <KitSheet
      projectName={project.name} result={result} parts={buildParts(result, t, cfg.locale)} requester={null}
      include={{ ...EVERYTHING, ...cfg.include }} date="19 Oct 2026" t={t} locale={cfg.locale}
    />,
  )
} else {
  root.render(
    <div className="workspace">
      <main className="page">
        <section className="stage">
          <h2>{tr(t, 'kitFor', { name: project.name })}</h2>
          <KitSummary result={result} baseline={null} projectName={project.name} quickEdit={null} onBatteryUnit={() => {}} />
        </section>
      </main>
    </div>,
  )
}

;(window as unknown as { __pages: () => unknown }).__pages = () => {
  const node = document.querySelector('.ksheet') as HTMLElement
  const { pages, pageHeight } = printPages(node)
  const blocks = [...node.querySelectorAll<HTMLElement>('[data-pdf-block]')].map((b) => ({
    cls: b.className, top: b.offsetTop, height: b.offsetHeight,
  }))
  const foot = node.querySelector<HTMLElement>('.ksheet__foot')
  return { pages, pageHeight, sheetHeight: node.offsetHeight, blocks, footHeight: foot?.offsetHeight ?? null }
}
