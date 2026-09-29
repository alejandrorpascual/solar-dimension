import { LayoutGrid } from 'lucide-react'
import { useState } from 'react'
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
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null)
  return (
    <div className="project-bar">
      <button type="button" className="chip project-bar__open" aria-haspopup="dialog" onClick={onOpenProjects}>
        <LayoutGrid size={16} aria-hidden="true" />{tr(t, 'projectsCount', { count: store.projects.length })}
      </button>
      <div className="project-bar__tools">
        <input
          key={current.id}
          className="in project-bar__name"
          type="text"
          aria-label={t.ui.projectName}
          value={draft?.id === current.id ? draft.name : current.name}
          placeholder={t.ui.untitled}
          maxLength={60}
          onChange={(e) => {
            const name = e.target.value
            setDraft({ id: current.id, name })
            if (name.trim()) commit(patchCurrent(store, { name }))
          }}
          onBlur={(e) => {
            const name = e.target.value.trim() || t.ui.untitled
            if (name !== current.name) commit(patchCurrent(store, { name }))
            setDraft(null)
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        />
        <button type="button" className="chip" onClick={() => commit(duplicateProject(store))}>{t.ui.duplicate}</button>
        {store.projects.length > 1 && (
          <button type="button" className="chip" onClick={() => commit(deleteProject(store))}>{t.ui.delete}</button>
        )}
      </div>
    </div>
  )
}
