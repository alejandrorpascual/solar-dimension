import { useCallback, useEffect, useRef, useState } from 'react'
import { clearPendingSave, hasPendingSave, loadStore, markPendingSave, saveStore, SYNCED_KEY } from '../lib/persistence'
import type { Project, Store } from '../lib/schema'
import { currentProject, initialStore } from '../lib/store'
import { adoptStale, applyChanges, diffProjects, hasUnsent, NOTHING_UNSENT, outgoing, unsentOf, type Unsent } from '../lib/sync'
import { deleteProjects, importProjects, listProjects, saveProjects } from '../server/projects'
import { useRootData } from './useRootData'

function fromServer(list: Project[], prev: Store): Store {
  const projects = list.length ? list : prev.projects
  const currentId = projects.some((p) => p.id === prev.currentId) ? prev.currentId : projects[0]!.id
  return { version: 1, projects, currentId }
}

export function useProjectStore() {
  const { user } = useRootData()
  const [store, setStore] = useState<Store>(initialStore)
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const latest = useRef(store)
  latest.current = store
  /**
   * Shows a store and keeps it in this browser. `latest` moves at once, not at the next render: a request that is
   * answered before React renders again must still read what the user last did.
   */
  const show = useCallback((next: Store) => {
    latest.current = next
    setStore(next)
    saveStore(next)
  }, [])
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
    const local = loadStore() ?? initialStore()
    latest.current = local
    setStore(local)
    loaded.current = false
    unsent.current = NOTHING_UNSENT
    if (!user) return
    let cancelled = false
    setSyncing(true)
    const alreadySynced = safeGet(SYNCED_KEY) === user.id
    // Push local state first on the very first sync for this account, or when a save never reached it (it failed, or
    // a reload or navigation cut it off); otherwise the server copy is the source of truth.
    const pushLocal = !alreadySynced || hasPendingSave()
    enqueue(() => (pushLocal ? importProjects({ data: { projects: local.projects } }) : listProjects()))
      .then((list) => {
        if (cancelled) return
        loaded.current = true
        safeSet(SYNCED_KEY, user.id)
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
  }, [user?.id, enqueue, show])

  const commit = useCallback((next: Store) => {
    const prev = latest.current
    show(next)
    if (!user) return
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
          sending.upserts.length ? saveProjects({ data: { projects: sending.upserts } }) : null,
          sending.deletes.length ? deleteProjects({ data: { ids: sending.deletes } }) : null,
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
  }, [user?.id, enqueue, isClean, show])

  return { store, project: currentProject(store), commit, syncing, saving, syncError }
}

function safeGet(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
function safeSet(key: string, v: string): void { try { localStorage.setItem(key, v) } catch { /* ignore */ } }
