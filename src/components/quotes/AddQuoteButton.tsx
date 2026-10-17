import { useId } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { useQuoteUpload } from '../../hooks/useQuoteUpload'
import { useRootData } from '../../hooks/useRootData'
import { FilePickButton } from './FilePickButton'
import { HandoffDialog } from './HandoffDialog'
import { QuotesLockedAction } from './QuotesLockedAction'

/**
 * "Add another quote" on the verdict page: the same upload and hand-off as the kit card. An account that may not start
 * reads gets a way to connect Google instead, or the note when there is none.
 */
export function AddQuoteButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useLocale()
  const { user } = useRootData()
  const upload = useQuoteUpload(projectId)
  const hintId = useId()
  if (!user?.canUseQuotes) return <QuotesLockedAction withNote />
  return (
    <>
      <FilePickButton label={t.quotes.addAnother} isDisabled={upload.isUploading} describedBy={hintId} onFiles={(files) => void upload.start(files)} />
      <p className="qmeta qfoot__hint" id={hintId}>{t.quotes.oneFilePerQuote}</p>
      <HandoffDialog isOpen={upload.isOpen} onOpenChange={upload.setOpen} items={upload.items} projectId={projectId} projectName={projectName} />
    </>
  )
}
