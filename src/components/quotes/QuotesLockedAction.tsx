import { useConnectGoogle } from '../../hooks/useConnectGoogle'
import { useLocale } from '../../hooks/useLocale'
import { useRootData } from '../../hooks/useRootData'
import { signedInUser } from '../../lib/account-session'

/**
 * What an account that may not start reads gets instead of an upload button: a way to connect Google, which verifies
 * it, when this deployment offers Google. Without Google (previews) there is nothing to do: the note alone, if asked.
 */
export function QuotesLockedAction({ withNote }: { withNote: boolean }) {
  const { t } = useLocale()
  const user = signedInUser(useRootData().session)
  const google = useConnectGoogle(user)
  if (google.canConnect) {
    return (
      <>
        <button type="button" className="qbtn" onClick={() => void google.connect()}>{t.quotes.connectGoogle}</button>
        {google.hasFailed && <p className="qerr" role="alert">{t.quotes.connectGoogleFailed}</p>}
      </>
    )
  }
  return withNote ? <p className="qmeta">{t.quotes.lockedNote}</p> : null
}
