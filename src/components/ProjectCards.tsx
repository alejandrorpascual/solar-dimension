import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Link } from '@tanstack/react-router'
import { FileText, Pencil } from 'lucide-react'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { useProjectJobs } from '../hooks/useQuoteJobs'
import { applianceName, batteryCount, tr, type Dictionary } from '../i18n'
import { fmtHours, fmtKwh, fmtW } from '../i18n/format'
import { projectLine } from '../lib/quote-text'
import { currentFirst, summarizeProjects, type ProjectSummary } from '../lib/project-summary'
import type { Store } from '../lib/schema'
import { addProject, deleteProject, duplicateProject, renameProject, selectProject, setQtyIn } from '../lib/store'
import { ProjectMenu } from './ProjectMenu'
import { ProjectNameField } from './ProjectNameField'
import { QtyStepper } from './QtyStepper'

interface Props {
  store: Store
  commit: (s: Store) => void
  /** Called after a project is opened or created, so a sheet can close. */
  onPicked?: () => void
}

/** "Refrigerator, 2× TV and 3 more" from the heaviest appliances. */
function heaviestLine(s: ProjectSummary, t: Dictionary): string {
  const list = s.heaviest.map((i) => (i.qty > 1 ? `${i.qty}× ` : '') + applianceName(t, i)).join(', ')
  return s.moreCount > 0 ? tr(t, 'heaviestMore', { list, count: s.moreCount }) : list
}

/** What only the open project's card can do: rename in place and the ··· menu. */
interface CurrentActions {
  isRenaming: boolean
  /** The title button, so focus can be put on it (see useTitleFocus). */
  titleRef: RefObject<HTMLButtonElement | null>
  canDelete: boolean
  onRename: () => void
  onRenameSave: (raw: string, byKey: boolean) => void
  onRenameCancel: () => void
  onDuplicate: () => void
  onDelete: () => void
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
  if (current?.isRenaming) return <ProjectNameField name={name} onSave={current.onRenameSave} onCancel={current.onRenameCancel} />
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

function ProjectCard({ summary: s, isEditing, current, onOpen, onToggleEdit, onQty }: CardProps) {
  const isCurrent = current !== undefined
  const { t, locale } = useLocale()
  const titleId = useId()
  const editId = useId()
  const { project: p, result: r } = s
  const jobs = useProjectJobs(p.id)
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
      {r.empty || !r.battery ? (
        <p className="muted pcard__empty">{t.ui.footerEmpty}</p>
      ) : (
        <>
          <dl className="pcard__figs">
            <div><dt className="lab">{t.ui.runtime}</dt><dd className="num">~{fmtHours(r.battery.hoursActual, locale)}</dd></div>
            <div><dt className="lab">{t.ui.bank}</dt><dd className="num">{fmtKwh(r.battery.bankWh, locale)}</dd></div>
            <div><dt className="lab">{t.ui.inverter}</dt><dd className="num">{fmtW(r.inverter.w, locale)}</dd></div>
          </dl>
          <div className="pcard__bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round(s.loadShare * 100))}%` }} /></div>
          <p className="pcard__load num">{`${fmtW(r.runningW, locale)} ${t.ui.running} · ${batteryCount(t, r.battery.count)} · ${r.cable.gauge}`}</p>
          <p className="pcard__items">{heaviestLine(s, t)}</p>
        </>
      )}
      {jobs && (
        <Link className="pcard__quotes" to="/projects/$projectId/quotes" params={{ projectId: p.id }}>
          <FileText size={14} aria-hidden="true" />{projectLine(t, jobs)}
        </Link>
      )}
      {isEditing && !isCurrent && r.items.length > 0 && (
        <ul id={editId} className="pcard__edit">
          {r.items.map((item) => (
            <li key={item.id} className="pcard__row">
              <span className="pcard__row-name">{applianceName(t, item)}</span>
              <QtyStepper size="sm" name={applianceName(t, item)} qty={item.qty} onSet={(n) => onQty(item.id, n)} />
            </li>
          ))}
        </ul>
      )}
      {/* The open project is edited in the main area (grid or kit quick edit, which owns Undo); one path, not two. */}
      {!isCurrent && r.items.length > 0 && (
        <button type="button" className={`chip pcard__toggle${isEditing ? ' chip--on' : ''}`} aria-expanded={isEditing} aria-controls={isEditing ? editId : undefined} onClick={onToggleEdit}>
          {isEditing ? t.ui.done : t.ui.quickEdit}
        </button>
      )}
    </article>
  )
}

/**
 * Puts focus on the open project's title after the next commit, so the keyboard is not stranded when the control that
 * had focus goes away: the name field on Enter or Escape, the ··· menu's button after Duplicate or Delete.
 */
function useTitleFocus() {
  const titleRef = useRef<HTMLButtonElement>(null)
  const [isRequested, setRequested] = useState(false)
  // In an effect, not while React commits: after a ··· menu action the page around the menu is still `inert` then, so
  // focus() would do nothing. react-aria lifts `inert` in the menu's effect cleanup, and React runs every cleanup of a
  // commit before any new effect.
  useEffect(() => {
    if (!isRequested) return
    titleRef.current?.focus()
    setRequested(false)
  }, [isRequested])
  return { titleRef, focusTitle: () => setRequested(true) }
}

/** Every saved project with its kit at a glance, the open one first; quick edit changes a project without opening it. */
export function ProjectCards({ store, commit, onPicked }: Props) {
  const { t } = useLocale()
  const appliances = useCatalog()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { titleRef, focusTitle } = useTitleFocus()
  // A new project opens on top already renaming; the sheet stays open until the name is saved.
  const createProject = () => {
    const next = addProject(store)
    commit(next)
    setRenamingId(next.currentId)
  }
  const currentActions = (id: string): CurrentActions => ({
    isRenaming: renamingId === id,
    titleRef,
    canDelete: store.projects.length > 1,
    onRename: () => setRenamingId(id),
    onRenameSave: (raw, byKey) => {
      setRenamingId(null)
      if (byKey) focusTitle()
      commit(renameProject(store, id, raw, t.ui.untitled))
    },
    onRenameCancel: () => {
      setRenamingId(null)
      focusTitle()
    },
    // The ··· button that had focus belongs to the card that was open; the project now open gets it instead.
    onDuplicate: () => {
      commit(duplicateProject(store))
      focusTitle()
    },
    onDelete: () => {
      commit(deleteProject(store))
      focusTitle()
    },
  })
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
          current={s.project.id === store.currentId ? currentActions(s.project.id) : undefined}
          isEditing={editingId === s.project.id}
          onOpen={() => { commit(selectProject(store, s.project.id)); onPicked?.() }}
          onToggleEdit={() => setEditingId(editingId === s.project.id ? null : s.project.id)}
          onQty={(itemId, n) => commit(setQtyIn(store, s.project.id, itemId, n))}
        />
      ))}
    </div>
  )
}
