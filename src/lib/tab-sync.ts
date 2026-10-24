import type { Project } from './schema'
import {
  editsOf, hasUnsent, mergeEdits, namedSave, NOTHING_UNSENT, outgoing, readBack, rebase, recordEdits, unsentOf,
  type Edits, type NamedEdits, type OwnEdits, type Unsent,
} from './sync'

/**
 * What one tab knows of its sync with the account, as one value. Every change makes a new one, and a change of account
 * starts again from NOT_SYNCED, so all of it is reset at once, a piece added later included.
 */
export type TabSync = {
  /** True once the first sync with the account worked; until then nothing here knows what the account holds. */
  readonly isLoaded: boolean
  /** What failed to reach the account since the last save that worked. The next save carries it again. */
  readonly unsent: Unsent
  /** The fields of `unsent`'s projects that edits changed, for that next save to name. */
  readonly unsentEdits: Edits
  /** The copy each field was last edited in here: a save sends a field it names at that edit's value and stamp. */
  readonly ownEdits: OwnEdits
  /** While the account is read again on coming back: the fields edited here since that read went out. */
  readonly editedInRead: Edits | null
  /** Ids of the projects the account has held as far as this tab knows: in a list it read, or in a save it answered. */
  readonly held: ReadonlySet<string>
}

/** A tab that has not synced with its account yet: at mount, and each time the account changes. */
export const NOT_SYNCED: TabSync = {
  isLoaded: false, unsent: NOTHING_UNSENT, unsentEdits: new Map(), ownEdits: new Map(), editedInRead: null, held: new Set(),
}

/** Whether the account holds everything this device does, as far as the requests answered so far can tell. */
export const isClean = (sync: TabSync): boolean => sync.isLoaded && !hasUnsent(sync.unsent)

const idsOf = (projects: readonly Project[]): ReadonlySet<string> => new Set(projects.map((p) => p.id))

/** The account's list was read: the tab now knows what the account holds. */
export const listRead = (sync: TabSync, list: readonly Project[]): TabSync => ({ ...sync, isLoaded: true, held: idsOf(list) })

/** A read of the account's list went out on coming back: edits from here on are laid over its answer. */
export const readSent = (sync: TabSync): TabSync => ({ ...sync, editedInRead: new Map() })

/** That read answered or failed: edits are no longer collected for it. */
export const readSettled = (sync: TabSync): TabSync => ({ ...sync, editedInRead: null })

/**
 * That read answered with `list`. `before` is what the screen showed when it went out, `after` what it shows now. The
 * projects to show are the list as readBack and rebase lay the edits made since over it.
 */
export function readAnswered(sync: TabSync, list: readonly Project[], before: readonly Project[], after: readonly Project[], isSaving: boolean): { sync: TabSync; projects: Project[] } {
  const shown = readBack(before, list, isSaving, sync.held)
  return { sync: listRead(sync, list), projects: rebase(shown, before, after, sync.editedInRead ?? new Map()) }
}

/** An edit here changed `upserts` from their copies in `prev`: the tab records it, and the fields it changed are returned. */
export function edited(sync: TabSync, prev: readonly Project[], upserts: readonly Project[]): { sync: TabSync; edits: Edits } {
  const edits = editsOf(prev, upserts)
  const editedInRead = sync.editedInRead && mergeEdits(sync.editedInRead, edits)
  return { sync: { ...sync, ownEdits: recordEdits(sync.ownEdits, upserts, edits), editedInRead }, edits }
}

/** One save as it goes out, and what the next save carries if this one fails. */
export type Save = { projects: Project[]; named: NamedEdits; deletes: string[]; unsent: Unsent; edits: Edits }

/**
 * The save of an edit that changed `change` and the fields `edits`, sent from `projects`: that change plus whatever
 * failed before it. Each project goes as `projects` holds it, naming the fields edits here changed, each at the value
 * and the stamp of its last edit here.
 */
export function saveOf(sync: TabSync, projects: readonly Project[], change: { upserts: readonly Project[]; deletes: readonly string[] }, edits: Edits): Save {
  const sending = outgoing(projects, change, sync.unsent)
  const carried = mergeEdits(sync.unsentEdits, edits)
  return { ...namedSave(sending.upserts, carried, sync.ownEdits), deletes: sending.deletes, unsent: unsentOf(sending), edits: carried }
}

/** The account took a save of `sent`: it holds those projects, and nothing failed is left to carry. */
export const saveAnswered = (sync: TabSync, sent: readonly Project[]): TabSync => ({
  ...sync, unsent: NOTHING_UNSENT, unsentEdits: new Map(), held: new Set([...sync.held, ...idsOf(sent)]),
})

/** A save failed: the next one carries all of it again. Sending a project or a delete twice changes nothing. */
export const saveFailed = (sync: TabSync, save: Save): TabSync => ({ ...sync, unsent: save.unsent, unsentEdits: save.edits })
