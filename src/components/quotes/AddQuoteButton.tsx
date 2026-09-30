import { Link } from '@tanstack/react-router'
import { useLocale } from '../../hooks/useLocale'
import { useQuoteUpload } from '../../hooks/useQuoteUpload'
import { useRootData } from '../../hooks/useRootData'
import { FilePickButton } from './FilePickButton'
import { HandoffDialog } from './HandoffDialog'

/**
 * "Add another quote" on the verdict page: the same upload and hand-off as the kit card. An account that may not start
 * reads gets the kit card's sign-in link instead.
 */
export function AddQuoteButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useLocale()
  const { user } = useRootData()
  const upload = useQuoteUpload(projectId)
  if (!user?.canUseQuotes) return <Link className="qbtn" to="/login">{t.quotes.cardGoogleSignIn}</Link>
  return (
    <>
      <FilePickButton label={t.quotes.addAnother} isDisabled={upload.isUploading} onFiles={(files) => void upload.start(files)} />
      <HandoffDialog isOpen={upload.isOpen} onOpenChange={upload.setOpen} items={upload.items} projectId={projectId} projectName={projectName} />
    </>
  )
}
