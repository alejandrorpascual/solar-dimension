import { useLocale } from '../hooks/useLocale'
import { useUndoSnapshot } from '../hooks/useUndoSnapshot'
import { tr } from '../i18n'
import { computeProject } from '../lib/project-summary'
import type { Project, Store } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { hasSameLoads, patchCurrent, restoreProject, setHoursIn, setQtyIn } from '../lib/store'
import { KitQuickEdit } from './KitQuickEdit'
import { KitSummary } from './KitSummary'

interface Props {
  store: Store
  commit: (s: Store) => void
  project: Project
  result: SizingResult
  onAllAppliances: () => void
}

/** Step 3: the kit, edited in place. Quick edits remember the project as it was before them, for the deltas and Undo. */
export function KitStep({ store, commit, project, result, onAllAppliances }: Props) {
  const { t } = useLocale()
  const undo = useUndoSnapshot(project, project.id)
  const isDirty = undo.snapshot !== null && !hasSameLoads(undo.snapshot, project)
  const quickEdit = (next: Store) => {
    undo.remember()
    commit(next)
  }
  const restore = () => {
    if (undo.snapshot) commit(restoreProject(store, undo.snapshot))
    undo.clear()
  }

  return (
    <>
      <h2>{tr(t, 'kitFor', { name: project.name })}</h2>
      <KitSummary
        result={result}
        baseline={isDirty && undo.snapshot ? computeProject(undo.snapshot) : null}
        projectName={project.name}
        quickEdit={
          <KitQuickEdit
            project={project}
            result={result}
            isDirty={isDirty}
            onQty={(itemId, n) => quickEdit(setQtyIn(store, project.id, itemId, n))}
            onHours={(hours) => quickEdit(setHoursIn(store, project.id, hours))}
            onUndo={restore}
            onAllAppliances={onAllAppliances}
          />
        }
        onBatteryUnit={(id) => commit(patchCurrent(store, { batteryUnit: id }))}
      />
    </>
  )
}
