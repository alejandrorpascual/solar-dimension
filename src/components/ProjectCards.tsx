import { useId, useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import { applianceName, batteryCount, tr, type Dictionary } from '../i18n'
import { fmtHours, fmtKwh, fmtW } from '../i18n/format'
import { summarizeProjects, type ProjectSummary } from '../lib/project-summary'
import type { Store } from '../lib/schema'
import { addProject, selectProject, setQtyIn } from '../lib/store'
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

interface CardProps {
  summary: ProjectSummary
  isCurrent: boolean
  isEditing: boolean
  onOpen: () => void
  onToggleEdit: () => void
  onQty: (itemId: string, n: number) => void
}

function ProjectCard({ summary: s, isCurrent, isEditing, onOpen, onToggleEdit, onQty }: CardProps) {
  const { t, locale } = useLocale()
  const titleId = useId()
  const editId = useId()
  const { project: p, result: r } = s
  return (
    <article className={`pcard${isCurrent ? ' pcard--on' : ''}`} aria-labelledby={titleId}>
      <div className="pcard__head">
        <h3 className="pcard__title" id={titleId}>
          <button type="button" className="pcard__pick" aria-current={isCurrent ? 'true' : undefined} onClick={onOpen}>{p.name}</button>
        </h3>
        {isCurrent && <span className="pcard__badge">{t.ui.current}</span>}
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

/** Every saved project with its kit at a glance; quick edit changes a project without opening it. */
export function ProjectCards({ store, commit, onPicked }: Props) {
  const { t } = useLocale()
  const [editingId, setEditingId] = useState<string | null>(null)
  return (
    <div className="pcards">
      <div className="pcards__head">
        <span className="lab">{t.ui.projects}</span>
        <button type="button" className="pcards__new" onClick={() => { commit(addProject(store)); onPicked?.() }}>{t.ui.newProject}</button>
      </div>
      {summarizeProjects(store.projects).map((s) => (
        <ProjectCard
          key={s.project.id}
          summary={s}
          isCurrent={s.project.id === store.currentId}
          isEditing={editingId === s.project.id}
          onOpen={() => { commit(selectProject(store, s.project.id)); onPicked?.() }}
          onToggleEdit={() => setEditingId(editingId === s.project.id ? null : s.project.id)}
          onQty={(itemId, n) => commit(setQtyIn(store, s.project.id, itemId, n))}
        />
      ))}
    </div>
  )
}
