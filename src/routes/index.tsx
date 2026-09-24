import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ProjectBar } from '../components/ProjectBar'
import { Stepper, type Step } from '../components/Stepper'
import { WizardFooter } from '../components/WizardFooter'
import { useProjectStore } from '../hooks/useProjectStore'
import { fmtKwh, fmtW } from '../lib/format'
import { compute, type SizingResult } from '../lib/sizing'

interface Search { step: Step }

function parseStep(v: unknown): Step {
  return v === 2 || v === '2' ? 2 : v === 3 || v === '3' ? 3 : 1
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => ({ step: parseStep(search.step) }),
  component: KitBuilderPage,
})

function footerSummary(step: Step, projectName: string, r: SizingResult): string {
  if (step === 1) return `${projectName} · ${r.count} appliances · ${fmtW(r.runningW)} running · ${fmtW(r.surgeW)} peak`
  if (step === 2) return `${r.hours} h at ${r.volts} V · ${fmtKwh(r.loadWh)} of load`
  if (r.empty || !r.battery) return 'Nothing selected yet'
  return `${r.battery.count} batteries · ${fmtW(r.inverter.w)} inverter · ${r.cable.gauge}`
}

function KitBuilderPage() {
  const { step } = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  const { store, project, commit } = useProjectStore()
  const result = compute({ qty: project.qty, custom: project.custom, hours: project.hours, volts: project.volts, chemistry: project.chemistry })
  const go = (next: Step) => navigate({ search: { step: next } })

  return (
    <main className="page">
      <header className="header">
        <div className="brand">Kit Builder</div>
        <Stepper step={step} />
      </header>
      <ProjectBar store={store} commit={commit} />
      <section className="stage">
        {step === 1 && <h2>Which appliances need to stay on?</h2>}
        {step === 2 && <h2>How long should the backup last?</h2>}
        {step === 3 && <h2>Kit for {project.name}</h2>}
      </section>
      <WizardFooter
        step={step}
        summary={footerSummary(step, project.name, result)}
        onBack={() => go((step - 1) as Step)}
        onNext={() => go((step + 1) as Step)}
        onStartOver={() => go(1)}
      />
    </main>
  )
}
