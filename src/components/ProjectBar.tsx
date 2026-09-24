import { useLocale } from '../hooks/useLocale'
import type { Store } from '../lib/schema'
import { addProject, currentProject, deleteProject, duplicateProject, patchCurrent, selectProject } from '../lib/store'

export function ProjectBar({ store, commit }: { store: Store; commit: (s: Store) => void }) {
  const { t } = useLocale()
  const current = currentProject(store)
  return (
    <div className="project-bar">
      <div className="lab">{t.ui.project}</div>
      <div className="hs project-bar__chips">
        {store.projects.map((p) => (
          <button key={p.id} type="button" className={`chip${p.id === current.id ? ' chip--on' : ''}`} onClick={() => commit(selectProject(store, p.id))}>
            {p.name}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => commit(addProject(store))}>{t.ui.newProject}</button>
      </div>
      <div className="project-bar__tools">
        <input
          className="in project-bar__name"
          type="text"
          aria-label={t.ui.projectName}
          value={current.name}
          maxLength={60}
          onChange={(e) => commit(patchCurrent(store, { name: e.target.value || t.ui.untitled }))}
        />
        <button type="button" className="chip" onClick={() => commit(duplicateProject(store))}>{t.ui.duplicate}</button>
        {store.projects.length > 1 && (
          <button type="button" className="chip" onClick={() => commit(deleteProject(store))}>{t.ui.delete}</button>
        )}
      </div>
    </div>
  )
}
