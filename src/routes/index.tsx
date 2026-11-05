import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LayoutGrid } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AccountMenu } from '../components/AccountMenu'
import { ApplianceGrid } from '../components/ApplianceGrid'
import { BackupWindow } from '../components/BackupWindow'
import { CustomApplianceForm } from '../components/CustomApplianceForm'
import { DownloadPanel } from '../components/DownloadPanel'
import { HeaderBar } from '../components/HeaderBar'
import { LegalLinks } from '../components/LegalLinks'
import { KitStep } from '../components/KitStep'
import { RailSheet, SideRail, type RailTab } from '../components/SideRail'
import { SolarStep } from '../components/solar/SolarStep'
import { WizardFooter } from '../components/WizardFooter'
import { useCatalog } from '../hooks/useCatalog'
import { useConnectGoogle } from '../hooks/useConnectGoogle'
import { useLocale } from '../hooks/useLocale'
import { useProjectStore } from '../hooks/useProjectStore'
import { useRootData } from '../hooks/useRootData'
import { useSignOut } from '../hooks/useSignOut'
import { applianceCount, batteryCount, inverterSize, panelCount, tr, type Dictionary, type Locale } from '../i18n'
import { fmtHours, fmtKw, fmtKwh, fmtW } from '../i18n/format'
import { signedInUser } from '../lib/account-session'
import { attentionLine } from '../lib/kit-checks'
import { computeProject } from '../lib/project-summary'
import { patchCurrent } from '../lib/store'
import { hasPanels, type SizingResult } from '../lib/sizing'
import { parseStep, type Step } from '../lib/steps'

/** `from` says step 1 was opened from the kit, so its main action goes back there. */
interface Search { step: Step; from?: 'kit' }

/** From this width the rail sits beside the page (rail.css); narrower screens open its content in a sheet. */
const RAIL_SHOWN = '(min-width: 1280px)'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => ({ step: parseStep(search.step), ...(search.from === 'kit' ? { from: 'kit' as const } : {}) }),
  component: KitBuilderPage,
})

/** The figure the kit's quick edit moves, in the footer so it stays in view while the list is edited. */
function runtimeLine(r: SizingResult, t: Dictionary, locale: Locale): string {
  return `${t.ui.runtime} ~${fmtHours(r.battery?.hoursActual ?? 0, locale)}`
}

function footerSummary(step: Step, name: string, r: SizingResult, t: Dictionary, locale: Locale): string {
  if (step === 1) return tr(t, 'footer1', { name, appliances: applianceCount(t, r.items.length, r.units), running: fmtW(r.runningW, locale), peak: fmtW(r.surgeW, locale) })
  if (step === 2) return tr(t, 'footer2', { hours: r.hours, volts: r.volts, load: fmtKwh(r.loadWh, locale), need: fmtKwh(r.requiredWh, locale) })
  if (step === 3) {
    const base = { hours: r.hours, volts: r.volts, load: fmtKwh(r.loadWh, locale) }
    return r.solar ? tr(t, 'footerSolar', { ...base, panels: panelCount(t, r.solar.panels), kw: fmtKw(r.solar.arrayW, locale) }) : tr(t, 'footerSolarNone', base)
  }
  if (r.empty || !r.battery) return t.ui.footerEmpty
  const base = { batteries: batteryCount(t, r.battery.count), inverter: inverterSize(t, r.inverter, locale), gauge: r.cable.gauge }
  const kit = r.solar ? tr(t, 'footer4Solar', { ...base, panels: panelCount(t, r.solar.panels) }) : tr(t, 'footer3', base)
  return `${runtimeLine(r, t, locale)} · ${kit}`
}

/** The footer line under 1024px, one row where it can be. The name shows beside the projects button there; undefined when the full line is already short. */
function footerSlim(step: Step, r: SizingResult, t: Dictionary, locale: Locale): string | undefined {
  if (r.empty) return t.ui.stepLocked
  if (step === 2) return tr(t, 'footer2Slim', { hours: r.hours, volts: r.volts, need: fmtKwh(r.requiredWh, locale) })
  if (step === 1) return `${applianceCount(t, r.items.length, r.units)} · ${fmtW(r.runningW, locale)} ${t.ui.running}`
  if (step === 3) {
    const base = { hours: r.hours, volts: r.volts }
    return hasPanels(r) ? tr(t, 'footerPanelsSlim', { ...base, panels: panelCount(t, r.solar.panels), kw: fmtKw(r.solar.arrayW, locale) }) : tr(t, 'footerNoPanelsSlim', base)
  }
  return r.battery ? `${runtimeLine(r, t, locale)} · ${batteryCount(t, r.battery.count)}` : undefined
}

/** The question each step asks; the kit step names the project it is for. */
function stepTitle(step: Step, name: string, t: Dictionary): string {
  if (step === 1) return t.ui.q1
  if (step === 2) return t.ui.q2
  if (step === 3) return t.ui.q3
  return tr(t, 'kitFor', { name })
}

/**
 * The step's heading, focused when the step changes (Next, Back, the stepper) so a screen reader announces the new
 * step. Not on the first render: a page that just loaded keeps focus where the browser put it. Nor while focus is in the
 * rail or its sheet, where a new project moves the page to step 1 with its name field in use.
 */
function useStepHeadingFocus(step: Step) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shownStep = useRef(step)
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    if (!document.activeElement?.closest('.rail, .rsheet')) headingRef.current?.focus()
  }, [step])
  return headingRef
}

/** How long a figure rests before it is read out, so a slider being dragged is not read at every step. */
const FIGURE_REST_MS = 600
/**
 * What the one status region reads out: the footer's figure after an edit moves it (not on a new step, whose heading takes
 * focus), and any message `announce` is given.
 */
function useStatusLine(step: Step, figure: string) {
  const [line, setLine] = useState('')
  const shown = useRef({ step, figure })
  // A figure moved by the action that just gave a message: the message already speaks for it. Lasts until the next frame.
  const isMessageFresh = useRef(false)
  useEffect(() => {
    const before = shown.current
    shown.current = { step, figure }
    if (before.step !== step || before.figure === figure) return
    if (isMessageFresh.current) return
    const timer = window.setTimeout(() => setLine(figure), FIGURE_REST_MS)
    return () => window.clearTimeout(timer)
  }, [step, figure])
  const announce = useCallback((message: string) => {
    isMessageFresh.current = true
    requestAnimationFrame(() => { isMessageFresh.current = false })
    setLine(message)
  }, [])
  return { line, announce }
}

/**
 * Shown only under 1280px, where the rail of project cards is hidden (rail.css). The button opens the cards in a
 * sheet: renaming, duplicating and deleting live on the open project's card. The name beside it says which project
 * is open, which steps 2 and 3 show nowhere else.
 */
function OpenProject({ name, count, onOpen }: { name: string; count: number; onOpen: () => void }) {
  const { t } = useLocale()
  return (
    <div className="project-open">
      <button type="button" className="chip project-open__chip" aria-haspopup="dialog" onClick={onOpen}>
        <LayoutGrid size={16} aria-hidden="true" />{tr(t, 'projectsCount', { count })}
      </button>
      <span className="project-open__name">{name}</span>
    </div>
  )
}

function KitBuilderPage() {
  const { step, from } = Route.useSearch()
  const { t, locale } = useLocale()
  const navigate = useNavigate({ from: '/' })
  const { session } = useRootData()
  const user = signedInUser(session)
  const appliances = useCatalog()
  const { store, project, commit, syncing, saving, syncError } = useProjectStore()
  const { signOut, hasFailed: hasSignOutFailed } = useSignOut(user)
  const google = useConnectGoogle(user)
  const result = computeProject(project, appliances)
  const go = (next: Step) => navigate({ search: { step: next } })
  const headingRef = useStepHeadingFocus(step)
  const openCatalogFromKit = () => navigate({ search: { step: 1, from: 'kit' } })
  const [isKitListOpen, setKitListOpen] = useState(false)
  // The rail sits beside the page on wide screens; narrower ones open the same content in a sheet.
  const [railTab, setRailTab] = useState<RailTab>('projects')
  const [isSheetOpen, setSheetOpen] = useState(false)
  const openSheet = (tab: RailTab) => {
    setRailTab(tab)
    setSheetOpen(true)
  }
  const railRef = useRef<HTMLElement>(null)
  // Where the rail shows, Download selects its tab and moves focus there, so a keyboard or screen reader user lands on it.
  const showDownload = () => {
    if (!window.matchMedia(RAIL_SHOWN).matches) return openSheet('download')
    flushSync(() => setRailTab('download'))
    railRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }
  const slim = footerSlim(step, result, t, locale)
  const summary = footerSummary(step, project.name, result, t, locale)
  const status = useStatusLine(step, slim ?? summary)
  const rail = { store, commit, tab: railTab, onTab: setRailTab, onProjectCreated: () => go(1), download: <DownloadPanel project={project} result={result} onRequesterChange={(requester) => commit(patchCurrent(store, { requester }))} /> }

  return (
    <div className="workspace">
      <main className="page">
        <HeaderBar stepper={{ step, onGo: go, hasAppliances: !result.empty }} account={<AccountMenu session={session} busy={syncing || saving} onSignOut={signOut} google={google} step={step} />} />
        {hasSignOutFailed && <div className="error" role="alert">{t.ui.signOutFailed}</div>}
        {google.hasFailed && <div className="error" role="alert">{t.quotes.connectGoogleFailed}</div>}
        <OpenProject name={project.name} count={store.projects.length} onOpen={() => openSheet('projects')} />
        {session.status === 'unreachable' && <div className="warn" role="status">{t.ui.accountUnreachable}</div>}
        {syncError && <div className="error" role="status">{t.ui.syncFailed}</div>}
        {syncing && <div className="muted">{t.ui.syncing}</div>}
        <section className="stage">
          <h1 ref={headingRef} tabIndex={-1} className="stage__title">{stepTitle(step, project.name, t)}</h1>
          {step === 1 && (
            <>
              <ApplianceGrid key={project.id} store={store} commit={commit} onAnnounce={status.announce} />
              <CustomApplianceForm store={store} commit={commit} onAdded={(name) => status.announce(tr(t, 'customAdded', { name }))} />
            </>
          )}
          {step === 2 && <BackupWindow store={store} commit={commit} result={result} />}
          {step === 3 && <SolarStep store={store} commit={commit} project={project} result={result} />}
          {step === 4 && <KitStep store={store} commit={commit} project={project} result={result} isSaving={saving || syncing} onAllAppliances={openCatalogFromKit} isListOpen={isKitListOpen} onListOpen={setKitListOpen} />}
        </section>
        <LegalLinks />
        <div className="visually-hidden" role="status">{status.line}</div>
        <WizardFooter
          step={step}
          summary={summary}
          summarySlim={slim}
          attention={attentionLine(t, result)}
          nextLocked={result.empty ? t.ui.stepLocked : null}
          onBack={() => go((step - 1) as Step)}
          onNext={() => go((step + 1) as Step)}
          onDownload={showDownload}
          onBackToKit={step === 1 && from === 'kit' ? () => go(4) : undefined}
          onAddAppliances={step === 4 && result.empty ? openCatalogFromKit : undefined}
          isDownloadOpen={railTab === 'download'}
        />
      </main>
      <aside ref={railRef} className="rail" aria-label={t.ui.projects}>
        <SideRail {...rail} />
      </aside>
      <RailSheet {...rail} isOpen={isSheetOpen} onOpenChange={setSheetOpen} />
    </div>
  )
}
