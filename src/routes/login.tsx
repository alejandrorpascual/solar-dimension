import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { HeaderBar } from '../components/HeaderBar'
import { useLocale } from '../hooks/useLocale'
import { signIn, signUp } from '../lib/auth-client'

export const Route = createFileRoute('/login')({
  loader: async ({ parentMatchPromise }) => {
    const root = await parentMatchPromise
    if (root.loaderData?.user) throw redirect({ to: '/', search: { step: 1 } })
  },
  component: LoginPage,
})

function LoginPage() {
  const { t } = useLocale()
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
      <HeaderBar step={1} />
      <section className="stage stage--narrow">
        <h2>{mode === 'up' ? t.ui.signUp : t.ui.signIn}</h2>
        <form className="form" onSubmit={submit}>
          <label className="field"><span className="lab">{t.ui.email}</span><input className="in" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span className="lab">{t.ui.password}</span><input className="in" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <div className="error" role="alert">{error}</div>}
          <button type="submit" className="btn btn--primary" disabled={busy}>{mode === 'up' ? t.ui.signUp : t.ui.signIn}</button>
          <button type="button" className="chip" onClick={() => setMode(mode === 'up' ? 'in' : 'up')}>{mode === 'up' ? t.ui.haveAccount : t.ui.noAccount}</button>
        </form>
      </section>
    </main>
  )
}
