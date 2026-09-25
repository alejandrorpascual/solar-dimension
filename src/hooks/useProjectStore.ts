import { useCallback, useEffect, useRef, useState } from 'react'
import { clearPendingSave, hasPendingSave, loadStore, markPendingSave, saveStore, SYNCED_KEY } from '../lib/persistence'
import type { Project, Store } from '../lib/schema'
import { currentProject, initialStore } from '../lib/store'
import { applyChanges, diffProjects } from '../lib/sync'
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
  const inFlight = useRef(0)
  // Every request to the account runs through this chain, so saves reach the server in the order they were made.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task, task)
    queue.current = next.catch(() => undefined)
    return next
  }, [])

  useEffect(() => {
    const local = loadStore() ?? initialStore()
    setStore(local)
    if (!user) return
    let cancelled = false
    setSyncing(true)
    const alreadySynced = safeGet(SYNCED_KEY) === user.id
    // Push local state first on the very first sync for this account, or when a previous save was cut off
    // by a reload or navigation; otherwise the server copy is the source of truth.
    const pushLocal = !alreadySynced || hasPendingSave()
    enqueue(() => (pushLocal ? importProjects({ data: { projects: local.projects } }) : listProjects()))
      .then((list) => {
        if (cancelled) return
        safeSet(SYNCED_KEY, user.id)
        if (inFlight.current === 0) clearPendingSave()
        // Edits made while the load was in flight are already queued behind it; keep them visible.
        const merged = fromServer(applyChanges(list, diffProjects(local.projects, latest.current.projects)), latest.current)
        setStore(merged)
        saveStore(merged)
      })
      .catch(() => { if (!cancelled) setSyncError(true) })
      .finally(() => { if (!cancelled) setSyncing(false) })
    return () => { cancelled = true }
  }, [user?.id, enqueue])

  const commit = useCallback((next: Store) => {
    const prev = latest.current
    setStore(next)
    saveStore(next)
    if (!user) return
    const { upserts, deletes } = diffProjects(prev.projects, next.projects)
    if (upserts.length === 0 && deletes.length === 0) return
    inFlight.current += 1
    markPendingSave()
    setSaving(true)
    enqueue(() => {
      const ops: Promise<unknown>[] = []
      if (upserts.length) ops.push(saveProjects({ data: { projects: upserts } }))
      if (deletes.length) ops.push(deleteProjects({ data: { ids: deletes } }))
      return Promise.all(ops)
    })
      .then(() => setSyncError(false))
      .catch(() => setSyncError(true))
      .finally(() => {
        inFlight.current -= 1
        if (inFlight.current === 0) {
          clearPendingSave()
          setSaving(false)
        }
      })
  }, [user?.id, enqueue])

  return { store, project: currentProject(store), commit, syncing, saving, syncError }
}

function safeGet(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
function safeSet(key: string, v: string): void { try { localStorage.setItem(key, v) } catch { /* ignore */ } }
