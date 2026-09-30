import { Link } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import { useId, useState, type DragEvent } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { useProjectJobs } from '../../hooks/useQuoteJobs'
import { useQuoteUpload } from '../../hooks/useQuoteUpload'
import { useRootData } from '../../hooks/useRootData'
import { trq } from '../../i18n'
import { MAX_MB } from '../../lib/quote-limits'
import { projectLine } from '../../lib/quote-text'
import type { Project } from '../../lib/schema'
import { FilePickButton } from './FilePickButton'
import { HandoffDialog } from './HandoffDialog'

interface Props { project: Project; isSaving: boolean }

/** Where quotes start, on the kit step. Signed out, it only says what signing in unlocks. */
export function QuotesCard({ project, isSaving }: Props) {
  const { t } = useLocale()
  const { user } = useRootData()
  const jobs = useProjectJobs(project.id)
  const upload = useQuoteUpload(project.id)
  const [isDragging, setDragging] = useState(false)
  const titleId = useId()
  const isBusy = isSaving || upload.isUploading

  if (!user) {
    return (
      <section className="qcard" aria-labelledby={titleId}>
        <span className="qcard__icon" aria-hidden="true"><FileText size={20} /></span>
        <div className="qcard__body">
          <h3 className="qcard__title" id={titleId}>{t.quotes.cardTitle}</h3>
          <p className="qcard__meta">{t.quotes.cardBody}</p>
        </div>
        <div className="qcard__actions"><Link className="qbtn" to="/login">{t.quotes.cardSignIn}</Link></div>
      </section>
    )
  }

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (!isBusy && files.length) void upload.start(files)
  }
  return (
    <section className={isDragging ? 'qcard qcard--drag' : 'qcard'} aria-labelledby={titleId}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <span className="qcard__icon" aria-hidden="true"><FileText size={20} /></span>
      <div className="qcard__body">
        <h3 className="qcard__title" id={titleId}>{jobs ? projectLine(t, jobs) : t.quotes.cardTitle}</h3>
        <p className="qcard__meta">{jobs ? trq(t, 'cardDrop', { mb: MAX_MB }) : t.quotes.cardBody}</p>
      </div>
      <div className="qcard__actions">
        {jobs && <Link className="qbtn" to="/projects/$projectId/quotes" params={{ projectId: project.id }}>{t.quotes.seeVerdict}</Link>}
        <FilePickButton
          label={isSaving ? t.quotes.cardSaving : jobs ? t.quotes.cardAddMore : t.quotes.cardUpload}
          isDisabled={isBusy}
          onFiles={(files) => void upload.start(files)}
        />
      </div>
      <HandoffDialog isOpen={upload.isOpen} onOpenChange={upload.setOpen} items={upload.items} projectId={project.id} projectName={project.name} />
    </section>
  )
}
