import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AccountMenu } from '../components/AccountMenu'
import { ApplianceGrid } from '../components/ApplianceGrid'
import { BackupWindow } from '../components/BackupWindow'
import { CustomApplianceForm } from '../components/CustomApplianceForm'
import { DownloadPanel } from '../components/DownloadPanel'
import { HeaderBar } from '../components/HeaderBar'
import { KitStep } from '../components/KitStep'
import { ProjectBar } from '../components/ProjectBar'
import { RailSheet, SideRail, type RailTab } from '../components/SideRail'
import type { Step } from '../components/Stepper'
import { SolarStep } from '../components/solar/SolarStep'
import { WizardFooter } from '../components/WizardFooter'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { useProjectStore } from '../hooks/useProjectStore'
import { useRootData } from '../hooks/useRootData'
import { batteryCount, tr, type Dictionary, type Locale } from '../i18n'
import { fmtKw, fmtKwh, fmtW } from '../i18n/format'
import { computeProject } from '../lib/project-summary'
import { patchCurrent } from '../lib/store'
import type { SizingResult } from '../lib/sizing'

interface Search { step: Step }

function parseStep(v: unknown): Step {
  return v === 2 || v === '2' ? 2 : v === 3 || v === '3' ? 3 : v === 4 || v === '4' ? 4 : 1
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => ({ step: parseStep(search.step) }),
  component: KitBuilderPage,
})

function footerSummary(step: Step, name: string, r: SizingResult, t: Dictionary, locale: Locale): string {
  if (step === 1) return tr(t, 'footer1', { name, count: r.count, running: fmtW(r.runningW, locale), peak: fmtW(r.surgeW, locale) })
  if (step === 2) return tr(t, 'footer2', { hours: r.hours, volts: r.volts, load: fmtKwh(r.loadWh, locale) })
  if (step === 3) {
    const base = { hours: r.hours, volts: r.volts, load: fmtKwh(r.loadWh, locale) }
    return r.solar ? tr(t, 'footerSolar', { ...base, panels: r.solar.panels, kw: fmtKw(r.solar.arrayW, locale) }) : tr(t, 'footerSolarNone', base)
  }
  if (r.empty || !r.battery) return t.ui.footerEmpty
  const base = { batteries: batteryCount(t, r.battery.count), inverter: fmtW(r.inverter.w, locale), gauge: r.cable.gauge }
  return r.solar ? tr(t, 'footer4Solar', { ...base, panels: r.solar.panels }) : tr(t, 'footer3', base)
}

function KitBuilderPage() {
  const { step } = Route.useSearch()
  const { t, locale } = useLocale()
  const navigate = useNavigate({ from: '/' })
  const { user } = useRootData()
  const appliances = useCatalog()
  const { store, project, commit, syncing, saving, syncError } = useProjectStore()
  const result = computeProject(project, appliances)
  const go = (next: Step) => navigate({ search: { step: next } })
  // The rail sits beside the page on wide screens; narrower ones open the same content in a sheet.
  const [railTab, setRailTab] = useState<RailTab>('projects')
  const [isSheetOpen, setSheetOpen] = useState(false)
  const openSheet = (tab: RailTab) => {
    setRailTab(tab)
    setSheetOpen(true)
  }
  const rail = { store, commit, tab: railTab, onTab: setRailTab, download: <DownloadPanel project={project} result={result} onRequesterChange={(requester) => commit(patchCurrent(store, { requester }))} /> }

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
              <h2>{t.ui.q3}</h2>
              <SolarStep store={store} commit={commit} project={project} result={result} />
            </>
          )}
          {step === 4 && <KitStep store={store} commit={commit} project={project} result={result} isSaving={saving || syncing} onAllAppliances={() => go(1)} />}
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
