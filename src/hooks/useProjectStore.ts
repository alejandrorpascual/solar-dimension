import { useCallback, useEffect, useState } from 'react'
import { loadStore, saveStore } from '../lib/persistence'
import type { Project, Store } from '../lib/schema'
import { currentProject, initialStore } from '../lib/store'

export function useProjectStore(): { store: Store; project: Project; commit: (next: Store) => void } {
  const [store, setStore] = useState<Store>(initialStore)

  useEffect(() => {
    const loaded = loadStore()
    if (loaded) setStore(loaded)
  }, [])

  const commit = useCallback((next: Store) => {
    setStore(next)
    saveStore(next)
  }, [])

  return { store, project: currentProject(store), commit }
}
