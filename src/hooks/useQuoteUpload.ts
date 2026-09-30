import { useCallback, useState } from 'react'
import { prepareQuoteFile } from '../client/prepare-quote-file'
import { checkBasics, type Rejection } from '../lib/quote-limits'
import { uploadQuote } from '../server/quotes/api'
import { useQuoteJobs } from './useQuoteJobs'

export interface UploadItem {
  key: string; name: string
  state: 'uploading' | 'accepted' | 'rejected'
  id: string | null; rejection: Rejection | null
}
type Outcome = Pick<UploadItem, 'state' | 'id' | 'rejection'>

async function uploadOne(projectId: string, raw: File): Promise<Outcome> {
  const file = await prepareQuoteFile(raw)
  const basic = checkBasics(file)
  if (basic) return { state: 'rejected', id: null, rejection: basic }
  const form = new FormData()
  form.set('projectId', projectId)
  form.set('file', file)
  try {
    const r = await uploadQuote({ data: form })
    return r.ok ? { state: 'accepted', id: r.id, rejection: null } : { state: 'rejected', id: null, rejection: r.rejection }
  } catch (error) {
    console.error('[quotes] upload failed', { name: raw.name, error })
    return { state: 'rejected', id: null, rejection: { code: 'upload' } }
  }
}

/** Uploads a batch one file at a time, so the server's per-project and monthly counts stay exact. */
export function useQuoteUpload(projectId: string) {
  const { refresh } = useQuoteJobs()
  const [items, setItems] = useState<UploadItem[]>([])
  const [isOpen, setOpen] = useState(false)
  const start = useCallback(async (files: readonly File[]) => {
    const batch = Date.now()
    const initial: UploadItem[] = files.map((f, i) => ({ key: `${batch}-${i}`, name: f.name, state: 'uploading', id: null, rejection: null }))
    setItems(initial)
    setOpen(true)
    for (const [i, file] of files.entries()) {
      const outcome = await uploadOne(projectId, file)
      const key = initial[i]?.key
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...outcome } : it)))
      if (outcome.state === 'accepted') await refresh()
    }
  }, [projectId, refresh])
  return { items, isOpen, setOpen, start }
}
