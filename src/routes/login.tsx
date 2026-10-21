import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { GoogleButton } from '../components/GoogleButton'
import { HeaderBar } from '../components/HeaderBar'
import { LegalLinks } from '../components/LegalLinks'
import { withEmailLink } from '../components/LegalPage'
import { useLocale } from '../hooks/useLocale'
import { useRootData } from '../hooks/useRootData'
import type { Dictionary } from '../i18n'
import { signIn, signUp } from '../lib/auth-client'

interface LoginSearch { error?: string }

export const Route = createFileRoute('/login')({
  // Better Auth sends failed Google sign-ins back here as ?error=<code>.
  validateSearch: (search: Record<string, unknown>): LoginSearch => (typeof search.error === 'string' ? { error: search.error } : {}),
  loader: async ({ parentMatchPromise }) => {
    const root = await parentMatchPromise
    if (root.loaderData?.user) throw redirect({ to: '/', search: { step: 1 } })
  },
  component: LoginPage,
})

/** account_not_linked: the email already has a password account, which Better Auth won't link without proof. */
function oauthErrorMessage(t: Dictionary, code: string | undefined): string {
  if (!code) return ''
  return code === 'account_not_linked' ? t.ui.googleExists : t.ui.googleFailed
}

function LoginPage() {
  const { t } = useLocale()
  const { googleEnabled } = useRootData()
  const { error: oauthError } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const res = mode === 'up'
      ? await signUp.email({ email, password, name: email.split('@')[0] ?? email })
      : await signIn.email({ email, password })
    setBusy(false)
    if (res.error) { setError(t.ui.authFailed); return }
    await router.invalidate({ sync: true })
    await navigate({ to: '/', search: { step: 1 } })
  }

  return (
    <main className="page">
      <HeaderBar stepper={{ step: 1 }} />
      <section className="stage stage--narrow">
        <h1 className="stage__title">{mode === 'up' ? t.ui.signUp : t.ui.signIn}</h1>
        {googleEnabled && (
          <>
            <GoogleButton label={t.ui.continueGoogle} />
            <div className="or" role="separator"><span>{t.ui.orDivider}</span></div>
          </>
        )}
        <form className="form" onSubmit={submit}>
          <label className="field"><span className="lab">{t.ui.email}</span><input className="in" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span className="lab">{t.ui.password}</span><input className="in" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <p className="form__note muted">{mode === 'up' ? t.ui.quotesNeedGoogle : withEmailLink(t.ui.recoverAccess)}</p>
          {(error || oauthError) && <div className="error" role="alert">{error || oauthErrorMessage(t, oauthError)}</div>}
          <button type="submit" className="btn btn--primary" disabled={busy}>{mode === 'up' ? t.ui.signUp : t.ui.signIn}</button>
          <button type="button" className="chip" onClick={() => setMode(mode === 'up' ? 'in' : 'up')}>{mode === 'up' ? t.ui.haveAccount : t.ui.noAccount}</button>
        </form>
        <LegalLinks />
      </section>
    </main>
  )
}
