import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dictionary } from '../i18n'
import { localCopyPlan } from '../lib/local-copy'
import {
  clearPendingSave, clearUnsent, hasPendingSave, loadOwner, loadStore, loadUnsent, markPendingSave, releaseAccountCopy, saveOwner, saveStore,
  STORAGE_KEY,
} from '../lib/persistence'
import type { Project, Store } from '../lib/schema'
import { currentProject, initialStore, nameFirstProject, rekeySeed, withSetAside } from '../lib/store'
import {
  adoptKept, adoptStale, applyChanges, diffProjects, editsOf, hasUnsent, mergeEdits, namedEdits, NOTHING_UNSENT, outgoing, readBack, rebase, unsentOf,
  type Edits, type Unsent,
} from '../lib/sync'
import { deleteProjects, importProjects, listProjects, saveProjects } from '../server/projects'
import { useLocale } from './useLocale'
import { useRootData } from './useRootData'

function fromServer(list: Project[], prev: Store): Store {
  const projects = list.length ? list : prev.projects
  const currentId = projects.some((p) => p.id === prev.currentId) ? prev.currentId : projects[0]!.id
  return { version: 1, projects, currentId }
}

/**
 * The projects this page starts from, for the account `account` (null: nobody is signed in), and whether they must be
 * sent before the account's own list is read.
 *
 * Projects that belong to an account other than the one signed in leave the browser before anything is shown. Work
 * done signed out becomes the account's, and so does what a session's end set aside for it; either way the copy is
 * marked as the account's with all of it still to send, so a load that fails does not leave it behind as work done
 * signed out for the next account to take.
 *
 * While the account cannot be read, the page starts from a new project and this browser's copy is left as it is.
 *
 * Until the account's list is read, the screen shows this copy, and the account's own first project is not in it:
 * the first project of a copy that is not the account's takes an id of its own, so nothing done to it meanwhile
 * reaches the account's.
 */
function startingCopy(account: string | null, isAccountUnreachable: boolean, t: Dictionary): { local: Store; mustPush: boolean } {
  // Someone may be signed in, and nobody can tell who: what this browser holds may be their account's, so it is neither
  // shown nor touched, and the page starts from a project of its own that nothing saves.
  if (isAccountUnreachable) return { local: initialStore(t), mustPush: false }
  // The owner first: reading it takes over a marker left by an earlier release, which sets the pending marker.
  const owner = loadOwner()
  const plan = localCopyPlan(account, owner, hasPendingSave())
  if (plan === 'release') releaseAccountCopy()
  // After a release nothing is read back: if storage refused the removal, the copy must still not be shown.
  const stored = plan === 'release' ? initialStore(t) : loadStore() ?? initialStore(t)
  if (!account) return { local: stored, mustPush: false }
  const isOwn = plan === 'pull' || plan === 'push'
  const setAside = loadUnsent(account)
  const local = withSetAside(isOwn ? stored : rekeySeed(stored), setAside, isOwn)
  const mustPush = plan !== 'pull' || setAside.length > 0
  if (mustPush) {
    saveStore(local)
    saveOwner(account)
    markPendingSave()
  }
  return { local, mustPush }
}

export function useProjectStore() {
  const { user, isAccountUnreachable } = useRootData()
  const account = user?.id ?? null
  const { t } = useLocale()
  /** The language on screen, for requests answered after it changed. */
  const language = useRef(t)
  language.current = t
  const [store, setStore] = useState<Store>(() => initialStore(t))
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const latest = useRef(store)
  latest.current = store
  /**
   * Shows a store and keeps it in this browser. `latest` moves at once, not at the next render: a request that is
   * answered before React renders again must still read what the user last did. Signed in, the copy is marked as the
   * account's on every write, not only at load: another tab may have signed out and released it meanwhile, and what
   * this page writes back must not read as work done signed out. While the account cannot be read nothing is kept: the
   * copy this browser holds may be the account's.
   */
  const show = useCallback((next: Store) => {
    latest.current = next
    setStore(next)
    if (isAccountUnreachable) return
    if (account) saveOwner(account)
    saveStore(next)
  }, [account, isAccountUnreachable])
  const inFlight = useRef(0)
  /** True once this mount's first sync with the account worked; until then nothing here knows what the account holds. */
  const loaded = useRef(false)
  /** What failed to reach the account since the last save that worked. The next save carries it again. */
  const unsent = useRef<Unsent>(NOTHING_UNSENT)
  /** The fields of `unsent`'s projects that edits changed, with the values they started from, for that next save to name. */
  const unsentEdits = useRef<Edits>(new Map())
  /** Whether the account holds everything this device does, as far as the requests answered so far can tell. */
  const isClean = useCallback(() => loaded.current && !hasUnsent(unsent.current), [])
  /**
   * The account state the page shows: a new token each time the account changes or becomes unreachable, null once the
   * page was left. A save answered under an earlier one must not write the store or clear the pending marker: what the
   * page shows now has its own copy and marker, and a marker left set only costs a push.
   */
  const scope = useRef<symbol | null>(null)
  useEffect(() => {
    scope.current = Symbol('account state')
    return () => { scope.current = null }
  }, [account, isAccountUnreachable])
  // Every request to the account runs through this chain, so saves reach the server in the order they were made.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task, task)
    queue.current = next.catch(() => undefined)
    return next
  }, [])

  useEffect(() => {
    const { local, mustPush } = startingCopy(account, isAccountUnreachable, language.current)
    latest.current = local
    setStore(local)
    loaded.current = false
    unsent.current = NOTHING_UNSENT
    // A load this run cancelled leaves the flag to it: with no account there is nothing to sync.
    setSyncing(account !== null)
    if (!account) return
    let cancelled = false
    // Unless something here still has to reach the account, the server copy is the source of truth.
    enqueue(() => (mustPush ? importProjects({ data: { account, projects: local.projects } }) : listProjects({ data: { account } })))
      .then((list) => {
        if (cancelled) return
        loaded.current = true
        clearUnsent(account)
        if (inFlight.current === 0) clearPendingSave()
        // Edits made while the load was in flight are already queued behind it; keep them visible. A first project
        // named for a language switched to meanwhile is no edit: compared in the language on screen, it is not one.
        const edits = diffProjects(nameFirstProject(local, language.current).projects, latest.current.projects)
        show(fromServer(applyChanges(list, edits), latest.current))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // The pending marker is left as it is: whatever it stands for still has to reach the account.
        console.error('[projects] load failed', { error })
        setSyncError(true)
      })
      .finally(() => { if (!cancelled) setSyncing(false) })
    return () => { cancelled = true }
  }, [account, isAccountUnreachable, enqueue, show])

  // Another tab of this browser kept its copy: show it here, so the next edit here starts from it instead of sending
  // this tab's older copy over that tab's edit. Nothing is written or sent: that tab did both. This tab keeps the project
  // it has open, and its own copy of a project stamped later than that tab's, which a save queued here sends. A copy
  // kept for another account (another tab signed out, or in as someone else) stays that tab's.
  useEffect(() => {
    if (isAccountUnreachable) return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || loadOwner() !== account) return
      const kept = loadStore()
      if (!kept) return
      const next = fromServer(adoptKept(latest.current.projects, kept.projects), latest.current)
      latest.current = next
      setStore(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [account, isAccountUnreachable])

  // Back on this tab: another device may have saved since. The account's list is read again and shown, with the fields
  // edited here meanwhile laid over it, so the click that brings the tab back may itself be an edit. A copy another tab
  // of this browser stamped later stays (readBack), as its save may not have landed yet. What is shown here never undoes
  // another tab's or device's edit in the account: a save names only the fields it changed. Only while this tab has
  // nothing unsent: a list read past an edit that never reached the account would take that edit off the screen.
  useEffect(() => {
    if (!account) return
    let isReading = false
    const reread = () => {
      if (isReading || document.visibilityState === 'hidden' || !isClean()) return
      isReading = true
      const readIn = scope.current
      // Edits made from here on are saved after this read, so the list cannot hold them yet.
      const before = latest.current
      enqueue(() => listProjects({ data: { account } }))
        .then((list) => {
          if (scope.current !== readIn || !isClean()) return
          show(fromServer(rebase(readBack(before.projects, list, hasPendingSave()), before.projects, latest.current.projects), latest.current))
        })
        .catch((error: unknown) => console.error('[projects] reload failed', { error }))
        .finally(() => { isReading = false })
    }
    window.addEventListener('focus', reread)
    document.addEventListener('visibilitychange', reread)
    return () => {
      window.removeEventListener('focus', reread)
      document.removeEventListener('visibilitychange', reread)
    }
  }, [account, enqueue, isClean, show])

  // A first project nobody has edited reads in the language on screen, wherever it came from: made here, read back from
  // this browser or from the account, or shown before the language was switched. Only the screen changes: nothing is
  // saved or sent for it, and an edit saves it under the name it shows.
  useEffect(() => {
    const named = nameFirstProject(latest.current, t)
    if (named === latest.current) return
    latest.current = named
    setStore(named)
  }, [store, t])

  const commit = useCallback((next: Store) => {
    const prev = latest.current
    show(next)
    if (!account) return
    const { upserts, deletes } = diffProjects(prev.projects, next.projects)
    if (upserts.length === 0 && deletes.length === 0) return
    const sentIn = scope.current
    const edits = editsOf(prev.projects, upserts)
    inFlight.current += 1
    markPendingSave()
    setSaving(true)
    enqueue(async () => {
      // What failed before goes again with this save. If either request fails both count as unsent: sending a
      // project or a delete twice changes nothing. Each project goes as the screen shows it now: a read of the account
      // answered since this edit has laid it over the account's copy, which the copy made at the edit would overwrite.
      // The save names the fields edits here changed and the values they started from, and the account writes only
      // those: a copy here that missed another tab's or device's edit to another field does not undo it.
      const sending = outgoing(scope.current === sentIn ? latest.current.projects : next.projects, { upserts, deletes }, unsent.current)
      const carried = mergeEdits(unsentEdits.current, edits)
      const named = namedEdits(sending.upserts, carried)
      try {
        const [saved] = await Promise.all([
          sending.upserts.length ? saveProjects({ data: { account, projects: sending.upserts, named } }) : null,
          sending.deletes.length ? deleteProjects({ data: { account, ids: sending.deletes } }) : null,
        ])
        unsent.current = NOTHING_UNSENT
        unsentEdits.current = new Map()
        return { sent: sending.upserts, stale: saved?.stale ?? [], named }
      } catch (error) {
        unsent.current = unsentOf(sending)
        unsentEdits.current = carried
        throw error
      }
    })
      .then(({ sent, stale, named }) => {
        if (scope.current !== sentIn) return
        if (stale.length) {
          // The account holds a newer copy of these: show it, unless the project was edited again meanwhile.
          show({ ...latest.current, projects: adoptStale(latest.current.projects, sent, stale, named) })
        }
        if (isClean()) setSyncError(false)
      })
      .catch((error: unknown) => {
        console.error('[projects] save failed', { error })
        setSyncError(true)
      })
      .finally(() => {
        inFlight.current -= 1
        if (inFlight.current > 0 || scope.current === null) return
        setSaving(false)
        // A save that failed keeps the marker, so the next load sends this device's copy before it reads the account's.
        // What that load sends is projects: one deleted here whose delete never arrived is back after it.
        if (scope.current === sentIn && isClean()) clearPendingSave()
      })
  }, [account, enqueue, isClean, show])

  return { store, project: currentProject(store), commit, syncing, saving, syncError }
}
