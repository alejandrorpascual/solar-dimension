import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { signIn } from '../lib/auth-client'

/** Google's four-colour "G", per its sign-in branding guidelines. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.2z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.8-.7-4.3s.3-2.9.7-4.3V14H4.5C3 17 2.2 20.4 2.2 24s.8 7 2.3 10l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
    </svg>
  )
}

/** Starts Google sign-in. Better Auth redirects the whole page; errors come back to /login as ?error=. */
export function GoogleButton({ label }: { label: string }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    const res = await signIn.social({ provider: 'google', callbackURL: '/?step=1', errorCallbackURL: '/login' })
    if (res.error) {
      setBusy(false)
      await navigate({ to: '/login', search: { error: 'google' } })
    }
  }

  return (
    <button type="button" className="btn btn--google" disabled={busy} aria-busy={busy} onClick={start}>
      <GoogleMark />
      {label}
    </button>
  )
}
