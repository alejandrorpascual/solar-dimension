# Google sign-in

**Date:** 2026-09-25 · **Status:** draft for review

## Goal
Let people sign in or create an account with Google, alongside email and password, without opening an account-takeover path.

## Context
- Auth is Better Auth 1.7 (`src/lib/auth.ts`) with the Drizzle adapter on Neon. The existing `account` table already stores OAuth rows (`provider_id`, `account_id`, tokens); no migration is needed.
- There is no email verification, so every password user has `email_verified = false`.
- Better Auth 1.7 refuses implicit linking to a local user whose email is unverified (`accountLinking.requireLocalEmailVerified` defaults to `true`) and returns the error `account_not_linked`. We keep that default and do not add Google to `trustedProviders`.
- Prerequisite done: the auth base URL uses the production domain (`d983c1f`), so the Google redirect URI is stable.
- Local projects are imported whenever `user.id` changes (`useProjectStore`), so a full-page OAuth redirect needs no sync changes.

## Design

### 1. Server: provider when configured
- `src/lib/auth.ts` adds `socialProviders.google = { clientId, clientSecret, prompt: 'select_account' }` only when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. A pure helper `googleProvider(env)` returns the config or `null`.
- Env vars are set in Vercel for Production and Development only. Preview hostnames change per deploy and Google requires exact redirect URIs, so previews do not offer Google.

### 2. Root data: `googleEnabled` and `googleLinked`
- The root loader (cached, `staleTime: Infinity`) adds `googleEnabled: boolean` (from `googleProvider(process.env) !== null`, via the existing server functions).
- `SessionUser` gains `googleLinked: boolean`, read in `getSession` from the user's accounts (`auth.api.listUserAccounts`) only when a session exists. It is refreshed by the existing `router.invalidate({ sync: true })` calls.

### 3. Login page
- When `googleEnabled`, `/login` shows a "Continue with Google" button above the email form, then an "or" divider.
- Click → `signIn.social({ provider: 'google', callbackURL: '/?step=1', errorCallbackURL: '/login' })`. The button shows a busy state while redirecting.
- `/login` validates an optional `error` search param. `account_not_linked` shows `googleExists`; any other value shows `googleFailed`.

### 4. Linking from the account menu
- When signed in, `googleEnabled` and `!user.googleLinked`, the account menu shows "Connect Google" → `authClient.linkSocial({ provider: 'google', callbackURL: <current path + search> })`. This is safe because it requires an existing session.
- After linking, the redirect back reloads root data, so the button disappears.

### 5. Copy (en / es)
| key | en | es |
|---|---|---|
| `continueGoogle` | Continue with Google | Continuar con Google |
| `orDivider` | or | o |
| `googleExists` | This email already has an account. Sign in with your password, then connect Google from the account menu. | Este correo ya tiene una cuenta. Inicia sesión con tu contraseña y luego conecta Google desde el menú de tu cuenta. |
| `googleFailed` | Google sign-in didn't finish. Try again. | No se completó el inicio con Google. Inténtalo de nuevo. |
| `connectGoogle` | Connect Google | Conectar Google |

The Google button follows Google's branding guidance: the multicolour "G" mark on a white button with a neutral border, and the text "Continue with Google".

### 6. Setup (done by the owner)
1. console.cloud.google.com → create project "Solar Dimension".
2. APIs & Services → OAuth consent screen: External; app name "Solar Dimension"; support and developer email; scopes `openid`, `email`, `profile`; publish the app (these basic scopes need no Google review).
3. Credentials → Create credentials → OAuth client ID → Web application. Authorised JavaScript origins: `https://solar-dimension.vercel.app`, `http://localhost:3000`. Authorised redirect URIs: `https://solar-dimension.vercel.app/api/auth/callback/google`, `http://localhost:3000/api/auth/callback/google`.
4. Add the values: `vercel env add GOOGLE_CLIENT_ID production`, `vercel env add GOOGLE_CLIENT_SECRET production`, the same for `development`, then `vercel env pull .env.local`.
5. Redeploy (push or `vercel --prod`) so production picks up the variables.

## Out of scope
Email verification, other providers, unlinking Google, avatars from the Google profile, Google on preview deployments, and the unused `NEON_AUTH_*` env vars from the Vercel integration.

## Testing
- Unit: `googleProvider(env)` returns `null` unless both vars are set and includes `prompt: 'select_account'`; `auth.options.socialProviders.google` exists when the vars are stubbed.
- E2E (local, with dummy Google vars in the Playwright web server env): the login page shows "Continue with Google"; clicking it navigates to `accounts.google.com` with `redirect_uri=http://localhost:3000/api/auth/callback/google` (asserted on the request, not by completing Google's flow); `/login?error=account_not_linked` shows `googleExists`. (The no-vars case is covered by the `googleProvider` unit test, since the Playwright web server env is fixed per run.)
- Manual on production after setup: new Google user lands on step 1 signed in; a password user's email via Google shows `googleExists`; that user can sign in with password, connect Google, sign out, and sign back in with Google.
