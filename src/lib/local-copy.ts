/**
 * What the kit builder does, as it mounts, with the projects this browser holds.
 *
 * - `show`: nobody is signed in and the copy is work done signed out. It is shown and stays in this browser.
 * - `adopt`: someone signed in and the copy is work done signed out. It becomes that account's and is sent to it.
 * - `pull`: the copy is the signed-in account's and the account has all of it. The account's list replaces it.
 * - `push`: the copy is the signed-in account's and some of it never reached the account. It is sent before reading.
 * - `release`: the copy is an account's and that account is not signed in here. It leaves the screen and the
 *   projects' storage; what never reached the account is set aside for that account's next sign-in.
 */
export type LocalCopyPlan = 'show' | 'adopt' | 'pull' | 'push' | 'release'

/**
 * `viewer` is the signed-in account's id, `owner` the account this browser's copy belongs to; null is nobody.
 *
 * An account's projects are on screen only while that account is signed in. So another account never receives them,
 * and a session that ended without a click on Sign out (it expired, or the cookies were cleared) is treated as a
 * sign-out the next time the page loads: on a shared computer the next person sees an empty project, not the last
 * user's clients. The owner signs in again to see them.
 */
export function localCopyPlan(viewer: string | null, owner: string | null, hasUnsent: boolean): LocalCopyPlan {
  if (owner !== null && owner !== viewer) return 'release'
  if (viewer === null) return 'show'
  if (owner === null) return 'adopt'
  return hasUnsent ? 'push' : 'pull'
}
