import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AccountMenu } from '../components/AccountMenu'
import { ApplianceGrid } from '../components/ApplianceGrid'
import { BackupWindow } from '../components/BackupWindow'
import { CustomApplianceForm } from '../components/CustomApplianceForm'
import { HeaderBar } from '../components/HeaderBar'
import { KitQuickEdit } from '../components/KitQuickEdit'
import { KitSummary } from '../components/KitSummary'
import { ProjectBar } from '../components/ProjectBar'
import { RailSheet, SideRail, type RailTab } from '../components/SideRail'
import type { Step } from '../components/Stepper'
import { WizardFooter } from '../components/WizardFooter'
import { useLocale } from '../hooks/useLocale'
import { useProjectStore } from '../hooks/useProjectStore'
import { useRootData } from '../hooks/useRootData'
import { useUndoSnapshot } from '../hooks/useUndoSnapshot'
import { batteryCount, tr, type Dictionary, type Locale } from '../i18n'
import { fmtKwh, fmtW } from '../i18n/format'
import { computeProject } from '../lib/project-summary'
import type { Store } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { hasSameLoads, patchCurrent, restoreProject, setHoursIn, setQtyIn } from '../lib/store'

interface Search { step: Step }

function parseStep(v: unknown): Step {
  return v === 2 || v === '2' ? 2 : v === 3 || v === '3' ? 3 : 1
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => ({ step: parseStep(search.step) }),
  component: KitBuilderPage,
})

function footerSummary(step: Step, name: string, r: SizingResult, t: Dictionary, locale: Locale): string {
  if (step === 1) return tr(t, 'footer1', { name, count: r.count, running: fmtW(r.runningW, locale), peak: fmtW(r.surgeW, locale) })
  if (step === 2) return tr(t, 'footer2', { hours: r.hours, volts: r.volts, load: fmtKwh(r.loadWh, locale) })
  if (r.empty || !r.battery) return t.ui.footerEmpty
  return tr(t, 'footer3', { batteries: batteryCount(t, r.battery.count), inverter: fmtW(r.inverter.w, locale), gauge: r.cable.gauge })
}

function KitBuilderPage() {
  const { step } = Route.useSearch()
  const { t, locale } = useLocale()
  const navigate = useNavigate({ from: '/' })
  const { user } = useRootData()
  const { store, project, commit, syncing, saving, syncError } = useProjectStore()
  const result = computeProject(project)
  const go = (next: Step) => navigate({ search: { step: next } })
  const undo = useUndoSnapshot(project, `${project.id}:${step}`)
  const isDirty = undo.snapshot !== null && !hasSameLoads(undo.snapshot, project)
  const quickEdit = (next: Store) => {
    undo.remember()
    commit(next)
  }
  const [railTab, setRailTab] = useState<RailTab>('projects')
  const [isSheetOpen, setSheetOpen] = useState(false)
  const openSheet = (tab: RailTab) => {
    setRailTab(tab)
    setSheetOpen(true)
  }
  const rail = { store, commit, tab: railTab, onTab: setRailTab, download: null }

  return (
    <div className="workspace">
    <main className="page">
      <HeaderBar step={step} account={<AccountMenu user={user} busy={syncing || saving} />} />
      <ProjectBar store={store} commit={commit} onOpenProjects={() => openSheet('projects')} />
      {syncError && <div className="error" role="status">{t.ui.syncFailed}</div>}
      {syncing && <div className="muted">{t.ui.syncing}</div>}
      <section className="stage">
        {step === 1 && (
          <>
            <h2>{t.ui.q1}</h2>
            <ApplianceGrid store={store} commit={commit} />
            <CustomApplianceForm store={store} commit={commit} />
          </>
        )}
        {step === 2 && (
          <>
            <h2>{t.ui.q2}</h2>
            <BackupWindow store={store} commit={commit} result={result} />
          </>
        )}
        {step === 3 && (
          <>
            <h2>{tr(t, 'kitFor', { name: project.name })}</h2>
            <KitSummary
              result={result}
              baseline={isDirty && undo.snapshot ? computeProject(undo.snapshot) : null}
              projectName={project.name}
              quickEdit={
                <KitQuickEdit
                  project={project}
                  result={result}
                  isDirty={isDirty}
                  onQty={(itemId, n) => quickEdit(setQtyIn(store, project.id, itemId, n))}
                  onHours={(hours) => quickEdit(setHoursIn(store, project.id, hours))}
                  onUndo={() => {
                    if (undo.snapshot) commit(restoreProject(store, undo.snapshot))
                    undo.clear()
                  }}
                  onAllAppliances={() => go(1)}
                />
              }
              onBatteryUnit={(id) => commit(patchCurrent(store, { batteryUnit: id }))}
            />
          </>
        )}
      </section>
      <WizardFooter
        step={step}
        summary={footerSummary(step, project.name, result, t, locale)}
        onBack={() => go((step - 1) as Step)}
        onNext={() => go((step + 1) as Step)}
        onStartOver={() => go(1)}
        onDownload={() => openSheet('download')}
      />
    </main>
    <aside className="rail" aria-label={t.ui.projects}>
      <SideRail {...rail} />
    </aside>
    <RailSheet {...rail} isOpen={isSheetOpen} onOpenChange={setSheetOpen} />
    </div>
  )
}
