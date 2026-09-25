import { LayoutGrid } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import type { Store } from '../lib/schema'
import { currentProject, deleteProject, duplicateProject, patchCurrent } from '../lib/store'

interface Props {
  store: Store
  commit: (s: Store) => void
  /** Opens the project list; the button only shows where the side rail is hidden. */
  onOpenProjects: () => void
}

export function ProjectBar({ store, commit, onOpenProjects }: Props) {
  const { t } = useLocale()
  const current = currentProject(store)
  return (
    <div className="project-bar">
      <button type="button" className="chip project-bar__open" aria-haspopup="dialog" onClick={onOpenProjects}>
        <LayoutGrid size={16} aria-hidden="true" />{tr(t, 'projectsCount', { count: store.projects.length })}
      </button>
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
