import { Link } from '@tanstack/react-router'
import { Check, FileText, TriangleAlert, X } from 'lucide-react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useLocale } from '../../hooks/useLocale'
import { useProjectJobs } from '../../hooks/useQuoteJobs'
import type { UploadItem } from '../../hooks/useQuoteUpload'
import { trq } from '../../i18n'
import { SECONDS_PER_QUOTE } from '../../lib/quote-jobs'
import { fileStatusText, rejectionText } from '../../lib/quote-text'

interface Props { isOpen: boolean; onOpenChange: (open: boolean) => void; items: UploadItem[]; projectId: string; projectName: string }

/** "We've got it from here": the files, what happens next, and that the user can close it and keep working. */
export function HandoffDialog({ isOpen, onOpenChange, items, projectId, projectName }: Props) {
  const { t } = useLocale()
  const jobs = useProjectJobs(projectId)
  const kept = items.filter((i) => i.state !== 'rejected')
  const rejected = items.filter((i) => i.state === 'rejected')
  const minutes = Math.max(1, Math.ceil((kept.length * SECONDS_PER_QUOTE) / 60))
  const statusOf = (it: UploadItem): string => {
    if (it.state === 'uploading') return fileStatusText(t, 'uploading')
    // The reason (type, size, a limit) is in the list below the tiles.
    if (it.state === 'rejected') return t.quotes.stRejected
    const job = jobs?.files.find((f) => f.id === it.id)
    return fileStatusText(t, job?.status ?? 'queued')
  }
  return (
    <ModalOverlay className="qdialog__overlay" isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Modal className="qdialog">
        <Dialog className="qdialog__body">
          {({ close }) => (
            <>
              <button type="button" className="qdialog__close" aria-label={t.ui.close} onClick={close}><X size={16} aria-hidden="true" /></button>
              <ul className="qdialog__tiles">
                {items.map((it) => (
                  <li key={it.key} className={it.state === 'rejected' ? 'qfile qfile--rejected' : 'qfile'}>
                    {it.state === 'rejected' ? <TriangleAlert size={18} aria-hidden="true" />
                      : jobs?.files.find((f) => f.id === it.id)?.status === 'ready' ? <Check size={18} aria-hidden="true" />
                        : <FileText size={18} aria-hidden="true" />}
                    <span className="qfile__name">{it.name}</span>
                    <span className="qfile__st">{statusOf(it)}</span>
                  </li>
                ))}
              </ul>
              <Heading slot="title" className="qdialog__title">{kept.length > 0 ? t.quotes.handoffTitle : t.quotes.handoffNone}</Heading>
              {kept.length > 0 && (
                <p className="qdialog__text">
                  {kept.length === 1
                    ? trq(t, 'handoffOne', { project: projectName, minutes })
                    : trq(t, 'handoffBody', { count: kept.length, project: projectName, minutes })}
                </p>
              )}
              {rejected.length > 0 && (
                <ul className="qdialog__rejected" role="alert">
                  {rejected.map((r) => (
                    <li key={r.key}>{trq(t, 'handoffRejected', { name: r.name, reason: r.rejection ? rejectionText(t, r.rejection) : t.quotes.errUpload })}</li>
                  ))}
                </ul>
              )}
              <div className="qdialog__actions">
                <button type="button" className="btn btn--primary" onClick={close}>{t.quotes.handoffOk}</button>
                {kept.length > 0 && (
                  <Link className="btn" to="/projects/$projectId/quotes" params={{ projectId }} onClick={close}>{t.quotes.handoffWatch}</Link>
                )}
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
