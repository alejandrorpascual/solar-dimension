# Google sign-in: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign in or sign up with Google next to email and password, and let password users connect Google from the account menu, with no implicit account linking.

**Architecture:** A pure `googleProvider(env)` decides whether Better Auth gets a Google provider. The cached root loader exposes `googleEnabled` (new server function) and `user.googleLinked` (from `listUserAccounts`). `/login` renders a `GoogleButton` and reads `?error=` from Better Auth's `errorCallbackURL`; `AccountMenu` offers `linkSocial`.

**Tech Stack:** Better Auth 1.7 (`socialProviders.google`, `signIn.social`, `linkSocial`, `listUserAccounts`), TanStack Start server functions and root loader, Vitest, Playwright.

Spec: `docs/superpowers/specs/2026-09-25-google-sign-in-design.md`

## Global Constraints
- Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Google is on only when both are non-empty.
- Never set `account.accountLinking.trustedProviders` or `requireLocalEmailVerified: false`; implicit linking must stay blocked for unverified local users.
- Provider options: `prompt: 'select_account'`.
- `signIn.social` args: `{ provider: 'google', callbackURL: '/?step=1', errorCallbackURL: '/login' }`.
- Copy keys and text exactly as the spec table (`continueGoogle`, `orDivider`, `googleExists`, `googleFailed`, `connectGoogle`), in `types.ts`, `en.ts`, `es.ts`.
- No secrets in code, tests or commits. Tests use the literal dummy values `e2e-google-client-id` / `e2e-google-client-secret`.
- Commit messages: `<type>: <description>`, no attribution lines.

---

### Task 1: Google provider on the server

**Files:** Create `src/lib/auth-google.ts`, `src/lib/auth-google.test.ts`. Modify `src/lib/auth.ts`, `src/lib/auth.test.ts`.

**Interfaces:** Produces
```ts
export interface GoogleProviderConfig { clientId: string; clientSecret: string; prompt: 'select_account' }
export function googleProvider(env: Partial<Record<'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET', string>>): GoogleProviderConfig | null
```

- [ ] **Step 1: Failing tests** (`auth-google.test.ts`):
```ts
import { describe, expect, test } from 'vitest'
import { googleProvider } from './auth-google'

describe('googleProvider', () => {
  test('is off unless both the client id and secret are set', () => {
    expect(googleProvider({})).toBeNull()
    expect(googleProvider({ GOOGLE_CLIENT_ID: 'id' })).toBeNull()
    expect(googleProvider({ GOOGLE_CLIENT_SECRET: 'secret' })).toBeNull()
    expect(googleProvider({ GOOGLE_CLIENT_ID: ' ', GOOGLE_CLIENT_SECRET: 'secret' })).toBeNull()
  })
  test('asks Google to show the account chooser', () => {
    expect(googleProvider({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }))
      .toEqual({ clientId: 'id', clientSecret: 'secret', prompt: 'select_account' })
  })
})
```
  In `auth.test.ts` add `vi.stubEnv('GOOGLE_CLIENT_ID', 'e2e-google-client-id')` and `vi.stubEnv('GOOGLE_CLIENT_SECRET', 'e2e-google-client-secret')` beside the existing stubs, and a test:
```ts
test('Google is a social provider when configured, and is not trusted for implicit linking', async () => {
  const { auth } = await import('./auth')
  expect(auth.options.socialProviders?.google?.clientId).toBe('e2e-google-client-id')
  expect(auth.options.account?.accountLinking?.trustedProviders ?? []).not.toContain('google')
})
```
- [ ] **Step 2:** `npx vitest run src/lib/auth-google.test.ts src/lib/auth.test.ts` → fail.
- [ ] **Step 3: Implement** `auth-google.ts`:
```ts
export interface GoogleProviderConfig { clientId: string; clientSecret: string; prompt: 'select_account' }

/** Google is offered only where both credentials exist (production and local dev, never previews). */
export function googleProvider(env: Partial<Record<'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET', string>>): GoogleProviderConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret, prompt: 'select_account' } : null
}
```
  In `auth.ts`: `const google = googleProvider(process.env)` and add `socialProviders: google ? { google } : {},` to `betterAuth({...})`.
- [ ] **Step 4:** tests pass; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat: Google as a Better Auth provider when its credentials are set`.

### Task 2: Root data knows about Google

**Files:** Modify `src/server/session.ts`, `src/hooks/useRootData.ts`, `src/routes/__root.tsx`.

**Interfaces:**
- Consumes `googleProvider` (Task 1).
- Produces `SessionUser { id; email; name; googleLinked: boolean }`, server fn `getAuthFeatures(): Promise<{ googleEnabled: boolean }>`, and `RootData { locale; user; googleEnabled: boolean }` from `useRootData()`.

- [ ] **Step 1: Implement** in `session.ts`:
```ts
export interface SessionUser { id: string; email: string; name: string; googleLinked: boolean }

export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<{ user: SessionUser } | null> => {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  const accounts = await auth.api.listUserAccounts({ headers })
  const googleLinked = accounts.some((a) => a.providerId === 'google')
  return { user: { id: session.user.id, email: session.user.email, name: session.user.name, googleLinked } }
})

export const getAuthFeatures = createServerFn({ method: 'GET' }).handler(async () => ({
  googleEnabled: googleProvider(process.env) !== null,
}))
```
  Root loader: `const [locale, session, features] = await Promise.all([getLocale(), getSession(), getAuthFeatures()])` → `return { locale, user: session?.user ?? null, googleEnabled: features.googleEnabled }`. `RootData` gains `googleEnabled: boolean`; `useRootData` returns `googleEnabled: data?.googleEnabled ?? false`.
- [ ] **Step 2:** `npm run typecheck && npx vitest run src`; `CI=true npx playwright test e2e/account.spec.ts` (sign-in still works, `listUserAccounts` returns the credential account).
- [ ] **Step 3:** Commit `feat: expose whether Google is on and linked in the cached root data`.

### Task 3: "Continue with Google" on the login page

**Files:** Create `src/components/GoogleButton.tsx`. Modify `src/routes/login.tsx`, `src/i18n/types.ts`, `en.ts`, `es.ts`, `src/styles/components.css`.

**Interfaces:** Consumes `useRootData().googleEnabled`. Produces `GoogleButton({ label }: { label: string })` and `/login` search `{ error?: string }`.

- [ ] **Step 1: i18n keys** exactly per spec table (all five).
- [ ] **Step 2: Component** `GoogleButton.tsx`: a `<button type="button" className="btn btn--google">` containing an inline SVG of Google's four-colour "G" (paths `#4285F4`, `#34A853`, `#FBBC05`, `#EA4335`, `aria-hidden`) and the label. On click: `setBusy(true)`; `await signIn.social({ provider: 'google', callbackURL: '/?step=1', errorCallbackURL: '/login' })`; if it resolves with `error`, `setBusy(false)` and navigate to `/login?error=google`. `disabled={busy}`, `aria-busy={busy}`.
- [ ] **Step 3: Login route.** `validateSearch: (s: Record<string, unknown>) => ({ error: typeof s.error === 'string' ? s.error : undefined })`. In `LoginPage`: `const { error: oauthError } = Route.useSearch()`; `const oauthMessage = oauthError === 'account_not_linked' ? t.ui.googleExists : oauthError ? t.ui.googleFailed : ''`. Above the form, when `googleEnabled`: `<GoogleButton label={t.ui.continueGoogle} />` then `<div className="or" role="separator"><span>{t.ui.orDivider}</span></div>`. Show `oauthMessage` in the existing `.error` `role="alert"` slot (form error wins if both). Update the two existing `navigate({ to: '/', search: { step: 1 } })` / `redirect` call sites only if the type checker requires `search` on `/login` links (`AccountMenu` `<Link to="/login" search={{}}>`).
- [ ] **Step 4: CSS:**
```css
.btn--google { display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; flex: 0 0 auto; border-color: var(--line-strong); }
.btn--google svg { flex-shrink: 0; }
.or { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 13px; margin: 4px 0; }
.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
```
- [ ] **Step 5:** typecheck + unit (i18n completeness test covers keys). Commit `feat: continue with Google on the sign-in page, with a clear message when the email already has a password account`.

### Task 4: "Connect Google" in the account menu

**Files:** Modify `src/components/AccountMenu.tsx`.

- [ ] **Step 1:** When `user && googleEnabled && !user.googleLinked`, render before Sign out:
```tsx
<button type="button" className="chip" disabled={busy} onClick={() => linkSocial({ provider: 'google', callbackURL: window.location.pathname + window.location.search })}>{t.ui.connectGoogle}</button>
```
  Export `linkSocial` from `src/lib/auth-client.ts` (`export const { signIn, signUp, signOut, useSession, linkSocial } = authClient`).
- [ ] **Step 2:** typecheck; commit `feat: connect Google from the account menu`.

### Task 5: E2E with dummy credentials

**Files:** Modify `playwright.config.ts`, add `e2e/google.spec.ts`.

- [ ] **Step 1:** `webServer.env = { GOOGLE_CLIENT_ID: 'e2e-google-client-id', GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret' }`.
- [ ] **Step 2: Tests:**
```ts
import { expect, test } from '@playwright/test'

test('Continue with Google sends the browser to Google with our callback URL', async ({ page }) => {
  let googleUrl = ''
  await page.route('https://accounts.google.com/**', (route) => { googleUrl = route.request().url(); return route.abort() })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect.poll(() => googleUrl).toContain('accounts.google.com')
  const url = new URL(googleUrl)
  expect(url.searchParams.get('client_id')).toBe('e2e-google-client-id')
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback/google')
  expect(url.searchParams.get('prompt')).toBe('select_account')
})

test('an email that already has a password account gets told how to connect Google', async ({ page }) => {
  await page.goto('/login?error=account_not_linked')
  await expect(page.getByRole('alert')).toHaveText(/already has an account/)
})

test('any other Google error asks to try again', async ({ page }) => {
  await page.goto('/login?error=access_denied')
  await expect(page.getByRole('alert')).toHaveText(/didn't finish/)
})
```
- [ ] **Step 3:** `npm run typecheck && npm run test:coverage && CI=true npm run e2e` → all pass. Screenshot `/login` at 375 and 1280, en and es.
- [ ] **Step 4:** Commit `test: e2e for the Google redirect and linking messages`.

### Task 6: Owner setup, deploy, manual check (needs the owner)

- [ ] Owner completes spec §6 (Google Cloud client + `vercel env add` for Production and Development + `vercel env pull .env.local`).
- [ ] Confirm names only: `vercel env ls | rg GOOGLE` shows both vars in Production and Development.
- [ ] Push to `main` (owner approval), wait for Vercel success.
- [ ] Manual on production (owner signs in; the agent never enters credentials): new Google user lands signed in on step 1; a password account's email via Google shows the "already has an account" message; that user signs in with password, clicks Connect Google, returns with the button gone; signs out and back in with Google.

### Task 7: Privacy page, then publish the Google app (text needs owner approval)

Google requires an External app's Branding page to list a home page and a public privacy policy before it can leave "Testing". Until then only listed test users (currently the owner) can use Google sign-in.

**Files:** Create `src/routes/privacy.tsx`, `e2e/privacy.spec.ts`. Modify `src/i18n/types.ts`, `en.ts`, `es.ts` (a `privacy` dictionary section), `src/routes/login.tsx` (link under the form), `src/styles/components.css` (reuse `.stage--narrow`).

- [ ] **Step 1: Owner approves the draft text** (en; es is a faithful translation):
  - **What we store:** your email and name, and, if you sign in with Google, your Google account ID. We also store the projects you save: appliances, hours, voltage and battery choices.
  - **Why:** to sign you in and keep your projects across devices. Nothing else.
  - **Sharing:** we don't sell or share your data. It's stored with our hosting and database providers (Vercel and Neon) only to run the app.
  - **Google data:** we only request your basic profile (name, email). We don't access Gmail, Drive or anything else.
  - **Cookies:** one sign-in session cookie and one language cookie. No ads or tracking.
  - **Delete your data:** email alexandros2707@gmail.com and we'll delete your account and projects.
  - **Updated:** {date of deploy}.
- [ ] **Step 2: Failing e2e:** `page.goto('/privacy')` shows heading "Privacy" and the text "We don't sell or share your data"; `/login` has a link "Privacy" pointing to `/privacy`; in Spanish the heading is "Privacidad".
- [ ] **Step 3: Implement** the route (static, no loader beyond root data), dictionary section, and the login link. Run typecheck, unit, e2e.
- [ ] **Step 4:** Commit `feat: privacy page`; push after owner approval; wait for Vercel success; confirm `https://solar-dimension.vercel.app/privacy` returns 200.
- [ ] **Step 5: Google Branding (ask the owner before saving):** Application home page `https://solar-dimension.vercel.app`, privacy policy `https://solar-dimension.vercel.app/privacy`, authorized domain `solar-dimension.vercel.app`. Save. No logo (a logo forces verification review).
- [ ] **Step 6:** Audience → Publish app → confirm "In production" (approved by the owner on 2026-09-25).
