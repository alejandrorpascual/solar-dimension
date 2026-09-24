import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AccountMenu } from '../components/AccountMenu'
import { ApplianceGrid } from '../components/ApplianceGrid'
import { BackupWindow } from '../components/BackupWindow'
import { CustomApplianceForm } from '../components/CustomApplianceForm'
import { HeaderBar } from '../components/HeaderBar'
import { KitSummary } from '../components/KitSummary'
import { ProjectBar } from '../components/ProjectBar'
import type { Step } from '../components/Stepper'
import { WizardFooter } from '../components/WizardFooter'
import { useLocale } from '../hooks/useLocale'
import { useProjectStore } from '../hooks/useProjectStore'
import { tr, type Dictionary, type Locale } from '../i18n'
import { fmtKwh, fmtW } from '../i18n/format'
import { compute, type SizingResult } from '../lib/sizing'
import { patchCurrent } from '../lib/store'

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
  return tr(t, 'footer3', { count: r.battery.count, inverter: fmtW(r.inverter.w, locale), gauge: r.cable.gauge })
}

function KitBuilderPage() {
  const { step } = Route.useSearch()
  const { t, locale } = useLocale()
  const navigate = useNavigate({ from: '/' })
  const { user } = Route.useRouteContext()
  const { store, project, commit, syncing, saving, syncError } = useProjectStore()
  const result = compute({
    qty: project.qty, custom: project.custom, hours: project.hours, volts: project.volts, chemistry: project.chemistry,
    batteryUnit: project.batteryUnit,
  })
  const go = (next: Step) => navigate({ search: { step: next } })

  return (
    <main className="page">
      <HeaderBar step={step} account={<AccountMenu user={user} busy={syncing || saving} />} />
      <ProjectBar store={store} commit={commit} />
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
              projectName={project.name}
              onEditAppliances={() => go(1)}
              onEditWindow={() => go(2)}
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
      />
    </main>
  )
}
