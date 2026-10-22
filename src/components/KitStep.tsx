import { useCatalog } from '../hooks/useCatalog'
import { useUndoSnapshot } from '../hooks/useUndoSnapshot'
import { oversizeNote } from '../lib/oversize'
import { computeProject } from '../lib/project-summary'
import type { Project, Store } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { hasSameLoads, patchCurrent, restoreProject, setDutyIn, setHoursIn, setQtyIn } from '../lib/store'
import { KitQuickEdit } from './KitQuickEdit'
import { KitSummary } from './KitSummary'
import { QuotesCard } from './quotes/QuotesCard'

interface Props {
  store: Store
  commit: (s: Store) => void
  project: Project
  result: SizingResult
  isSaving: boolean
  onAllAppliances: () => void
}

/** Step 3: the kit, edited in place. Quick edits remember the project as it was before them, for the deltas and Undo. */
export function KitStep({ store, commit, project, result, isSaving, onAllAppliances }: Props) {
  const appliances = useCatalog()
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
      <KitSummary
        result={result}
        baseline={isDirty && undo.snapshot ? computeProject(undo.snapshot, appliances) : null}
        projectName={project.name}
        oversize={oversizeNote(project, appliances)}
        quickEdit={
          <KitQuickEdit
            project={project}
            result={result}
            isDirty={isDirty}
            onQty={(itemId, n) => quickEdit(setQtyIn(store, project.id, itemId, n))}
            onHours={(hours) => quickEdit(setHoursIn(store, project.id, hours))}
            onDuty={(itemId, duty) => quickEdit(setDutyIn(store, project.id, itemId, duty))}
            onUndo={restore}
            onAllAppliances={onAllAppliances}
          />
        }
        onBatteryUnit={(id) => commit(patchCurrent(store, { batteryUnit: id }))}
      />
      <QuotesCard project={project} isSaving={isSaving} />
    </>
  )
}
