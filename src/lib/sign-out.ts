export interface SignOutSteps {
  /** Ends the session. Answers with an error, or rejects when no answer came back. */
  signOut: () => Promise<{ error: unknown }>
  /** Takes the account's projects off this browser. */
  release: () => void
  /** Loads the page's data again, now for nobody. */
  reload: () => Promise<unknown>
}

/**
 * Signing out of this browser, and whether the session ended. The account's projects leave only once it has: after a
 * sign-out that failed the account is still signed in, and they stay where they are. On a shared computer the next
 * person must not find them, or have them added to their own account.
 */
export async function signOutOfBrowser({ signOut, release, reload }: SignOutSteps): Promise<boolean> {
  let failure: unknown
  try {
    failure = (await signOut()).error
  } catch (error) {
    // No answer came back. If the session did end, the next page load finds no session and releases the projects.
    failure = error ?? new Error('Sign-out was rejected')
  }
  if (failure) {
    console.error('[auth] signing out failed', { error: failure })
    return false
  }
  release()
  await reload()
  return true
}
