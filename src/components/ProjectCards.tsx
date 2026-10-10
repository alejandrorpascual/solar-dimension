import { useId, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FileText, Pencil } from 'lucide-react'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { useProjectRename, type CurrentActions } from '../hooks/useProjectRename'
import { useProjectJobs } from '../hooks/useQuoteJobs'
import { applianceName, batteryCount, tr, type Dictionary } from '../i18n'
import { fmtHours, fmtKwh, fmtW } from '../i18n/format'
import { projectLine } from '../lib/quote-text'
import { currentFirst, summarizeProjects, type ProjectSummary } from '../lib/project-summary'
import type { Store } from '../lib/schema'
import type { SelectedItem } from '../lib/sizing'
import { selectProject, setQtyIn } from '../lib/store'
import { ProjectMenu } from './ProjectMenu'
import { ProjectNameField } from './ProjectNameField'
import { QtyStepper } from './QtyStepper'

/** The narrowest the load bar is drawn, in percent, so the lightest kit still shows a mark. */
const LOAD_BAR_MIN_PERCENT = 4

interface Props {
  store: Store
  commit: (s: Store) => void
  /**
   * Called when the person is done with the cards, so the phone's sheet can close: after another project's card opens
   * it, and after Enter in the name field of a project that was just created. Leaving that field or pressing Escape
   * in it does not call this, and neither does renaming an existing project. The desktop rail passes nothing.
   */
  onPicked?: () => void
}

/** "Refrigerator, 2× TV and 3 more" from the heaviest appliances. */
function heaviestLine(s: ProjectSummary, t: Dictionary): string {
  const list = s.heaviest.map((i) => (i.qty > 1 ? `${i.qty}× ` : '') + applianceName(t, i)).join(', ')
  return s.moreCount > 0 ? tr(t, 'heaviestMore', { list, count: s.moreCount }) : list
}

interface CardProps {
  summary: ProjectSummary
  isEditing: boolean
  /** Present only on the open project's card. */
  current?: CurrentActions
  onOpen: () => void
  onToggleEdit: () => void
  onQty: (itemId: string, n: number) => void
}

function CardTitle({ name, titleId, current, onOpen }: { name: string; titleId: string; current?: CurrentActions; onOpen: () => void }) {
  if (current?.isRenaming) return <ProjectNameField id={titleId} name={name} onType={current.onRenameType} onClose={current.onRenameClose} />
  return (
    <h3 className="pcard__title" id={titleId}>
      {current ? (
        <button ref={current.titleRef} type="button" className="pcard__pick" aria-current="true" onClick={current.onRename}>
          {name}<Pencil size={14} className="pcard__pencil" aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className="pcard__pick" onClick={onOpen}>{name}</button>
      )}
    </h3>
  )
}

/** A project's kit at a glance: runtime, bank and inverter, its load beside the heaviest project's, and what draws the most. */
function CardKit({ summary: s }: { summary: ProjectSummary }) {
  const { t, locale } = useLocale()
  const r = s.result
  if (r.empty || !r.battery) return <p className="muted pcard__empty">{t.ui.footerEmpty}</p>
  return (
    <>
      <dl className="pcard__figs">
        <div><dt className="lab">{t.ui.runtime}</dt><dd className="num">~{fmtHours(r.battery.hoursActual, locale)}</dd></div>
        <div><dt className="lab">{t.ui.bank}</dt><dd className="num">{fmtKwh(r.battery.bankWh, locale)}</dd></div>
        <div><dt className="lab">{t.ui.inverter}</dt><dd className="num">{fmtW(r.inverter.w, locale)}</dd></div>
      </dl>
      <div className="pcard__bar" aria-hidden="true"><span style={{ width: `${Math.max(LOAD_BAR_MIN_PERCENT, Math.round(s.loadShare * 100))}%` }} /></div>
      <p className="pcard__load num">{`${fmtW(r.runningW, locale)} ${t.ui.running} · ${batteryCount(t, r.battery.count)} · ${r.cable.gauge}`}</p>
      <p className="pcard__items">{heaviestLine(s, t)}</p>
    </>
  )
}

/** Quick edit's list on another project's card: one quantity stepper per appliance. */
function CardQuickEdit({ id, items, onQty }: { id: string; items: readonly SelectedItem[]; onQty: (itemId: string, n: number) => void }) {
  const { t } = useLocale()
  return (
    <ul id={id} className="pcard__edit">
      {items.map((item) => (
        <li key={item.id} className="pcard__row">
          <span className="pcard__row-name">{applianceName(t, item)}</span>
          <QtyStepper size="sm" name={applianceName(t, item)} qty={item.qty} onSet={(n) => onQty(item.id, n)} />
        </li>
      ))}
    </ul>
  )
}

function ProjectCard({ summary: s, isEditing, current, onOpen, onToggleEdit, onQty }: CardProps) {
  const isCurrent = current !== undefined
  const { t } = useLocale()
  const titleId = useId()
  const editId = useId()
  const { project: p, result: r } = s
  const jobs = useProjectJobs(p.id)
  // The open project is edited in the main area (grid or kit quick edit, which owns Undo); one path, not two.
  const canQuickEdit = !isCurrent && r.items.length > 0
  return (
    // Another project's card opens it from anywhere: the name button's ::after stretches over the card (rail.css).
    // Off while Quick edit is open, so clicks between its steppers do nothing.
    <article className={`pcard${isCurrent ? ' pcard--on' : ''}${!isCurrent && !isEditing ? ' pcard--pickable' : ''}`} aria-labelledby={titleId}>
      <div className="pcard__head">
        <CardTitle name={p.name} titleId={titleId} current={current} onOpen={onOpen} />
        {current && <span className="pcard__badge">{t.ui.current}</span>}
        {current && !current.isRenaming && (
          <ProjectMenu name={p.name} canDelete={current.canDelete} onRename={current.onRename} onDuplicate={current.onDuplicate} onDelete={current.onDelete} />
        )}
      </div>
      <p className="pcard__meta num">{tr(t, 'projectMeta', { volts: p.volts, hours: p.hours, count: r.items.length })}</p>
      <CardKit summary={s} />
      {jobs && (
        <Link className="pcard__quotes" to="/projects/$projectId/quotes" params={{ projectId: p.id }}>
          <FileText size={14} aria-hidden="true" />{projectLine(t, jobs)}
        </Link>
      )}
      {isEditing && canQuickEdit && <CardQuickEdit id={editId} items={r.items} onQty={onQty} />}
      {canQuickEdit && (
        <button type="button" className={`chip pcard__toggle${isEditing ? ' chip--on' : ''}`} aria-expanded={isEditing} aria-controls={isEditing ? editId : undefined} onClick={onToggleEdit}>
          {isEditing ? t.ui.done : t.ui.quickEdit}
        </button>
      )}
    </article>
  )
}

/** Every saved project with its kit at a glance, the open one first; quick edit changes a project without opening it. */
export function ProjectCards({ store, commit, onPicked }: Props) {
  const { t } = useLocale()
  const appliances = useCatalog()
  const [editingId, setEditingId] = useState<string | null>(null)
  const { createProject, currentActions } = useProjectRename({ store, commit, onPicked })
  return (
    <div className="pcards">
      <div className="pcards__head">
        <span className="lab">{t.ui.projects}</span>
        <button type="button" className="pcards__new" onClick={createProject}>{t.ui.newProject}</button>
      </div>
      {currentFirst(summarizeProjects(store.projects, appliances), store.currentId).map((s) => (
        <ProjectCard
          key={s.project.id}
          summary={s}
          current={s.project.id === store.currentId ? currentActions : undefined}
          isEditing={editingId === s.project.id}
          onOpen={() => { commit(selectProject(store, s.project.id)); onPicked?.() }}
          onToggleEdit={() => setEditingId(editingId === s.project.id ? null : s.project.id)}
          onQty={(itemId, n) => commit(setQtyIn(store, s.project.id, itemId, n))}
        />
      ))}
    </div>
  )
}
