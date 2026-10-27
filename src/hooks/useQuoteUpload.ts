import { useCallback, useRef, useState } from 'react'
import { prepareQuoteFile } from '../client/prepare-quote-file'
import { signedInUser } from '../lib/account-session'
import { checkBasics, type Rejection } from '../lib/quote-limits'
import { createSingleFlight } from '../lib/single-flight'
import { uploadQuote } from '../server/quotes/api'
import { useQuoteJobs } from './useQuoteJobs'
import { useRootData } from './useRootData'

export interface UploadItem {
  key: string; name: string
  state: 'uploading' | 'accepted' | 'rejected'
  id: string | null; rejection: Rejection | null
}
type Outcome = Pick<UploadItem, 'state' | 'id' | 'rejection'>

/** `account` is the account the page was loaded for (see requireAccount); undefined only when nobody is signed in. */
async function uploadOne(account: string | undefined, projectId: string, raw: File): Promise<Outcome> {
  const file = await prepareQuoteFile(raw)
  const basic = checkBasics(file)
  if (basic) return { state: 'rejected', id: null, rejection: basic }
  const form = new FormData()
  if (account) form.set('account', account)
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

/**
 * Uploads a batch one file at a time, so the server's per-project and monthly counts stay exact. A second `start`
 * while a batch is running is ignored, so the first batch's tiles stay and the uploads never overlap.
 */
export function useQuoteUpload(projectId: string) {
  const { refresh } = useQuoteJobs()
  const account = signedInUser(useRootData().session)?.id
  const [items, setItems] = useState<UploadItem[]>([])
  const [isOpen, setOpen] = useState(false)
  const [isUploading, setUploading] = useState(false)
  const gate = useRef(createSingleFlight())
  const runBatch = useCallback(async (files: readonly File[]) => {
    const batch = Date.now()
    const initial: UploadItem[] = files.map((f, i) => ({ key: `${batch}-${i}`, name: f.name, state: 'uploading', id: null, rejection: null }))
    setItems(initial)
    setOpen(true)
    for (const [i, file] of files.entries()) {
      const outcome = await uploadOne(account, projectId, file)
      const key = initial[i]?.key
      setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...outcome } : it)))
      if (outcome.state === 'accepted') await refresh()
    }
  }, [account, projectId, refresh])
  const start = useCallback(async (files: readonly File[]) => {
    if (!gate.current.tryEnter()) return
    setUploading(true)
    try {
      await runBatch(files)
    } finally {
      gate.current.release()
      setUploading(false)
    }
  }, [runBatch])
  return { items, isOpen, isUploading, setOpen, start }
}
