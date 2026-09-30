import { useLocale } from '../../hooks/useLocale'
import { useQuoteUpload } from '../../hooks/useQuoteUpload'
import { FilePickButton } from './FilePickButton'
import { HandoffDialog } from './HandoffDialog'

/** "Add another quote" on the verdict page: the same upload and hand-off as the kit card. */
export function AddQuoteButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useLocale()
  const upload = useQuoteUpload(projectId)
  return (
    <>
      <FilePickButton label={t.quotes.addAnother} isDisabled={upload.isUploading} onFiles={(files) => void upload.start(files)} />
      <HandoffDialog isOpen={upload.isOpen} onOpenChange={upload.setOpen} items={upload.items} projectId={projectId} projectName={projectName} />
    </>
  )
}
