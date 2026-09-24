import { useRouteContext } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadStore, saveStore, SYNCED_KEY } from '../lib/persistence'
import type { Project, Store } from '../lib/schema'
import { currentProject, initialStore } from '../lib/store'
import { diffProjects } from '../lib/sync'
import { deleteProjects, importProjects, listProjects, saveProjects } from '../server/projects'

function fromServer(list: Project[], prev: Store): Store {
  const projects = list.length ? list : prev.projects
  const currentId = projects.some((p) => p.id === prev.currentId) ? prev.currentId : projects[0]!.id
  return { version: 1, projects, currentId }
}

export function useProjectStore() {
  const { user } = useRouteContext({ from: '__root__' })
  const [store, setStore] = useState<Store>(initialStore)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const latest = useRef(store)
  latest.current = store

  useEffect(() => {
    const local = loadStore() ?? initialStore()
    setStore(local)
    if (!user) return
    let cancelled = false
    setSyncing(true)
    const alreadySynced = safeGet(SYNCED_KEY) === user.id
    const load = alreadySynced ? listProjects() : importProjects({ data: { projects: local.projects } })
    load
      .then((list) => {
        if (cancelled) return
        safeSet(SYNCED_KEY, user.id)
        const next = fromServer(list, local)
        setStore(next)
        saveStore(next)
      })
      .catch(() => { if (!cancelled) setSyncError(true) })
      .finally(() => { if (!cancelled) setSyncing(false) })
    return () => { cancelled = true }
  }, [user?.id])

  const commit = useCallback((next: Store) => {
    const prev = latest.current
    setStore(next)
    saveStore(next)
    if (!user) return
    const { upserts, deletes } = diffProjects(prev.projects, next.projects)
    const ops: Promise<unknown>[] = []
    if (upserts.length) ops.push(saveProjects({ data: { projects: upserts } }))
    if (deletes.length) ops.push(deleteProjects({ data: { ids: deletes } }))
    Promise.all(ops).then(() => setSyncError(false)).catch(() => setSyncError(true))
  }, [user?.id])

  return { store, project: currentProject(store), commit, syncing, syncError }
}

function safeGet(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
function safeSet(key: string, v: string): void { try { localStorage.setItem(key, v) } catch { /* ignore */ } }
