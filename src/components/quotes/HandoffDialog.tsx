import { Link } from '@tanstack/react-router'
import { ArrowRight, X } from 'lucide-react'
import { useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLocale } from '../../hooks/useLocale'
import { useProjectJobs, useQuoteJobs } from '../../hooks/useQuoteJobs'
import { useRootData } from '../../hooks/useRootData'
import type { UploadItem } from '../../hooks/useQuoteUpload'
import { trq } from '../../i18n'
import { signedInUser } from '../../lib/account-session'
import { SECONDS_PER_QUOTE } from '../../lib/quote-jobs'
import { handoffRowState, handoffSummary } from '../../lib/quote-progress'
import { rejectionText } from '../../lib/quote-text'
import { deleteQuote, retryQuote } from '../../server/quotes/api'
import { HandoffRow } from './HandoffRow'

interface Props { isOpen: boolean; onOpenChange: (open: boolean) => void; items: UploadItem[]; projectId: string; projectName: string }

/** "We've got it from here": each file with how it is doing, what happens next, and that the user can close it and keep working. */
export function HandoffDialog({ isOpen, onOpenChange, items, projectId, projectName }: Props) {
  const { t } = useLocale()
  const jobs = useProjectJobs(projectId)
  const { refresh } = useQuoteJobs()
  const account = signedInUser(useRootData().session)?.id
  // Files deleted from here: the upload still lists them, but they are gone.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const shown = items.filter((i) => !removed.has(i.key))
  const fileOf = (it: UploadItem) => jobs?.files.find((f) => f.id === it.id) ?? null
  const statusOf = (it: UploadItem) => fileOf(it)?.status ?? null
  const kept = shown.filter((i) => i.state !== 'rejected')
  const minutes = Math.max(1, Math.ceil((kept.length * SECONDS_PER_QUOTE) / 60))
  const summary = handoffSummary(t, shown.map((it) => handoffRowState(it, statusOf(it))))

  const setError = (key: string, text: string | null) => setErrors((e) => {
    const { [key]: _old, ...rest } = e
    return text === null ? rest : { ...rest, [key]: text }
  })
  const retry = (it: UploadItem) => async () => {
    if (it.id === null) return
    setError(it.key, null)
    try {
      const res = await retryQuote({ data: { account, quoteId: it.id } })
      if (!res.ok) setError(it.key, rejectionText(t, res.rejection))
      await refresh()
    } catch (e) {
      console.error('[quotes] retrying from the hand-off dialog failed', { id: it.id, e })
      setError(it.key, t.quotes.saveFailed)
    }
  }
  const remove = (it: UploadItem) => async () => {
    if (it.id === null) return
    setError(it.key, null)
    try {
      await deleteQuote({ data: { account, quoteId: it.id } })
      setRemoved((r) => new Set([...r, it.key]))
      await refresh()
    } catch (e) {
      console.error('[quotes] deleting from the hand-off dialog failed', { id: it.id, e })
      setError(it.key, t.quotes.saveFailed)
    }
  }

  return (
    <ModalOverlay className="qdialog__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="qdialog">
        <Dialog className="qdialog__body">
          {({ close }) => (
            <>
              <button type="button" className="qdialog__close" aria-label={t.ui.close} onClick={close}><X size={16} aria-hidden="true" /></button>
              <Heading slot="title" className="qdialog__title">{kept.length > 0 ? t.quotes.handoffTitle : t.quotes.handoffNone}</Heading>
              {kept.length > 0 && (
                <p className="qdialog__text">
                  {kept.length === 1
                    ? trq(t, 'handoffOne', { project: projectName, minutes })
                    : trq(t, 'handoffBody', { count: kept.length, project: projectName, minutes })}
                </p>
              )}
              {shown.length > 0 && (
                <ul className="qhand">
                  {shown.map((it) => (
                    <HandoffRow key={it.key} item={it} file={fileOf(it)} error={errors[it.key] ?? null}
                      onRetry={() => void retry(it)()} onDelete={() => void remove(it)()} />
                  ))}
                </ul>
              )}
              {summary && <p className="qhand__summary" aria-live="polite">{summary}</p>}
              <p className="qmeta">{t.quotes.oneFilePerQuote}</p>
              <div className="qdialog__actions">
                <button type="button" className="btn btn--primary" onClick={close}>{t.quotes.handoffOk}</button>
                {kept.length > 0 && (
                  <Link className="btn btn--quiet" to="/projects/$projectId/quotes" params={{ projectId }} onClick={close}>
                    {t.quotes.handoffWatch}<ArrowRight size={16} aria-hidden="true" />
                  </Link>
                )}
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
