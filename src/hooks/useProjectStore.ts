import { useCallback, useEffect, useRef, useState } from 'react'
import { localCopyPlan } from '../lib/local-copy'
import {
  clearPendingSave, clearUnsent, hasPendingSave, loadOwner, loadStore, loadUnsent, markPendingSave, releaseAccountCopy, saveOwner, saveStore,
} from '../lib/persistence'
import type { Project, Store } from '../lib/schema'
import { currentProject, initialStore, rekeyEditedSeed } from '../lib/store'
import { adoptStale, applyChanges, diffProjects, hasUnsent, newestById, NOTHING_UNSENT, outgoing, unsentOf, type Unsent } from '../lib/sync'
import { deleteProjects, importProjects, listProjects, saveProjects } from '../server/projects'
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
 */
function startingCopy(account: string | null): { local: Store; mustPush: boolean } {
  // The owner first: reading it takes over a marker left by an earlier release, which sets the pending marker.
  const owner = loadOwner()
  const plan = localCopyPlan(account, owner, hasPendingSave())
  if (plan === 'release') releaseAccountCopy()
  // After a release nothing is read back: if storage refused the removal, the copy must still not be shown.
  const stored = plan === 'release' ? initialStore() : loadStore() ?? initialStore()
  if (!account) return { local: stored, mustPush: false }
  const isOwn = plan === 'pull' || plan === 'push'
  const setAside = loadUnsent(account)
  const mine = isOwn ? stored : rekeyEditedSeed(stored)
  const local = setAside.length ? { ...mine, projects: newestById([...setAside, ...mine.projects]) } : mine
  const mustPush = plan !== 'pull' || setAside.length > 0
  if (mustPush) {
    saveStore(local)
    saveOwner(account)
    markPendingSave()
  }
  return { local, mustPush }
}

export function useProjectStore() {
  const { user } = useRootData()
  const account = user?.id ?? null
  const [store, setStore] = useState<Store>(initialStore)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const latest = useRef(store)
  latest.current = store
  /**
   * Shows a store and keeps it in this browser. `latest` moves at once, not at the next render: a request that is
   * answered before React renders again must still read what the user last did. Signed in, the copy is marked as the
   * account's on every write, not only at load: another tab may have signed out and released it meanwhile, and what
   * this page writes back must not read as work done signed out.
   */
  const show = useCallback((next: Store) => {
    latest.current = next
    setStore(next)
    if (account) saveOwner(account)
    saveStore(next)
  }, [account])
  const inFlight = useRef(0)
  /** True once this mount's first sync with the account worked; until then nothing here knows what the account holds. */
  const loaded = useRef(false)
  /** What failed to reach the account since the last save that worked. The next save carries it again. */
  const unsent = useRef<Unsent>(NOTHING_UNSENT)
  /** Whether the account holds everything this device does, as far as the requests answered so far can tell. */
  const isClean = useCallback(() => loaded.current && !hasUnsent(unsent.current), [])
  /**
   * False once the page was left. A save answered after that must not write the store or clear the pending marker:
   * the page that replaced this one has shown and marked its own, and a marker left set only costs that page a push.
   */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  // Every request to the account runs through this chain, so saves reach the server in the order they were made.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task, task)
    queue.current = next.catch(() => undefined)
    return next
  }, [])

  useEffect(() => {
    const { local, mustPush } = startingCopy(account)
    latest.current = local
    setStore(local)
    loaded.current = false
    unsent.current = NOTHING_UNSENT
    if (!account) return
    let cancelled = false
    setSyncing(true)
    // Unless something here still has to reach the account, the server copy is the source of truth.
    enqueue(() => (mustPush ? importProjects({ data: { account, projects: local.projects } }) : listProjects()))
      .then((list) => {
        if (cancelled) return
        loaded.current = true
        clearUnsent(account)
        if (inFlight.current === 0) clearPendingSave()
        // Edits made while the load was in flight are already queued behind it; keep them visible.
        show(fromServer(applyChanges(list, diffProjects(local.projects, latest.current.projects)), latest.current))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // The pending marker is left as it is: whatever it stands for still has to reach the account.
        console.error('[projects] load failed', { error })
        setSyncError(true)
      })
      .finally(() => { if (!cancelled) setSyncing(false) })
    return () => { cancelled = true }
  }, [account, enqueue, show])

  const commit = useCallback((next: Store) => {
    const prev = latest.current
    show(next)
    if (!account) return
    const { upserts, deletes } = diffProjects(prev.projects, next.projects)
    if (upserts.length === 0 && deletes.length === 0) return
    inFlight.current += 1
    markPendingSave()
    setSaving(true)
    enqueue(async () => {
      // What failed before goes again with this save. If either request fails both count as unsent: sending a
      // project or a delete twice changes nothing.
      const sending = outgoing(next.projects, { upserts, deletes }, unsent.current)
      try {
        const [saved] = await Promise.all([
          sending.upserts.length ? saveProjects({ data: { account, projects: sending.upserts } }) : null,
          sending.deletes.length ? deleteProjects({ data: { account, ids: sending.deletes } }) : null,
        ])
        unsent.current = NOTHING_UNSENT
        return { sent: sending.upserts, stale: saved?.stale ?? [] }
      } catch (error) {
        unsent.current = unsentOf(sending)
        throw error
      }
    })
      .then(({ sent, stale }) => {
        if (!alive.current) return
        if (stale.length) {
          // The account holds a newer copy of these: show it, unless the project was edited again meanwhile.
          show({ ...latest.current, projects: adoptStale(latest.current.projects, sent, stale) })
        }
        if (isClean()) setSyncError(false)
      })
      .catch((error: unknown) => {
        console.error('[projects] save failed', { error })
        setSyncError(true)
      })
      .finally(() => {
        inFlight.current -= 1
        if (inFlight.current > 0 || !alive.current) return
        setSaving(false)
        // A save that failed keeps the marker, so the next load sends this device's copy before it reads the account's.
        // What that load sends is projects: one deleted here whose delete never arrived is back after it.
        if (isClean()) clearPendingSave()
      })
  }, [account, enqueue, isClean, show])

  return { store, project: currentProject(store), commit, syncing, saving, syncError }
}
