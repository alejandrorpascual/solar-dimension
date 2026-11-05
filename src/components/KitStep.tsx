import { useId } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useUndoSnapshot } from '../hooks/useUndoSnapshot'
import { oversizeNote } from '../lib/oversize'
import { computeProject } from '../lib/project-summary'
import type { Project, Store } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { hasSameLoads, patchCurrent, restoreProject, setDutyIn, setHoursIn, setQtyIn } from '../lib/store'
import { KitQuickEditBar, KitQuickEditPanel } from './KitQuickEdit'
import { KitSummary } from './KitSummary'
import { QuotesCard } from './quotes/QuotesCard'

interface Props {
  store: Store
  commit: (s: Store) => void
  project: Project
  result: SizingResult
  isSaving: boolean
  onAllAppliances: () => void
  /** Kept by the page, so the list is still open on coming back from the appliances step. */
  isListOpen: boolean
  onListOpen: (isOpen: boolean) => void
}

/** Step 3: the kit, edited in place. Quick edits remember the project as it was before them, for the deltas and Undo. */
export function KitStep({ store, commit, project, result, isSaving, onAllAppliances, isListOpen, onListOpen }: Props) {
  const appliances = useCatalog()
  const panelId = useId()
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
          <KitQuickEditBar
            project={project}
            result={result}
            isDirty={isDirty}
            isOpen={isListOpen}
            panelId={panelId}
            onToggle={() => onListOpen(!isListOpen)}
            onHours={(hours) => quickEdit(setHoursIn(store, project.id, hours))}
            onUndo={restore}
          />
        }
        quickEditPanel={isListOpen && (
          <KitQuickEditPanel
            id={panelId}
            project={project}
            result={result}
            onQty={(itemId, n) => quickEdit(setQtyIn(store, project.id, itemId, n))}
            onDuty={(itemId, duty) => quickEdit(setDutyIn(store, project.id, itemId, duty))}
            onAllAppliances={onAllAppliances}
          />
        )}
        onBatteryUnit={(id) => commit(patchCurrent(store, { batteryUnit: id }))}
      />
      <QuotesCard project={project} isSaving={isSaving} />
    </>
  )
}
