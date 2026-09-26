export interface GoogleProviderConfig { clientId: string; clientSecret: string; prompt: 'select_account' }

type GoogleEnv = Partial<Record<'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET', string>>

/**
 * Google is offered only where both credentials exist: production and local dev, never previews, whose per-deploy
 * hostnames can't be registered as redirect URIs. `select_account` lets people on a shared computer pick an account.
 */
export function googleProvider(env: GoogleEnv): GoogleProviderConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret, prompt: 'select_account' } : null
}
