// The delete behind scripts/delete-e2e-users.mjs, apart from its command line so the e2e suite can run it on one
// account of its own (e2e/user-cleanup.spec.ts).
import { createHash } from 'node:crypto'
import type { NeonQueryFunction } from '@neondatabase/serverless'

const E2E_EMAIL_PREFIX = 'e2e-'
const E2E_EMAIL_DOMAIN = '@example.com'
/** Every e2e sign-up uses this shape. example.com is reserved (RFC 2606), so no real mailbox has such an address. */
export const E2E_EMAIL_PATTERN = `${E2E_EMAIL_PREFIX}%${E2E_EMAIL_DOMAIN}`
export const FINGERPRINT_LENGTH = 12
/** Postgres's code for a transaction that cannot go on because of what another one committed (serialization_failure). */
const SERIALIZATION_FAILURE = '40001'

/** Same value as the delete's SQL check: md5 of the ids in byte order (collate "C"), joined by commas. */
export function fingerprintOf(ids: readonly string[]): string {
  return createHash('md5').update([...ids].sort().join(',')).digest('hex').slice(0, FINGERPRINT_LENGTH)
}

const isSerializationFailure = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === SERIALIZATION_FAILURE

/**
 * Deletes the accounts whose email matches `pattern`, with their projects, and returns how many of each went. One
 * statement that removes nothing when the matching accounts no longer have `fingerprint` (one appeared or disappeared
 * since the listing), or when any of them has a quote. Only e2e emails: a wrong pattern never reaches a real account.
 *
 * It runs at repeatable read. The statement's checks see what was committed when it began, but the foreign keys
 * delete what is there when it ends: at the default level, a quote that an upload committed in between went with its
 * project, and its file stayed in storage with no row to find it by. At this level Postgres will not delete a row the
 * transaction could not see; it fails the transaction, nothing is removed, and this throws.
 */
export async function deleteAccounts(
  sql: NeonQueryFunction<false, false>, pattern: string, fingerprint: string,
): Promise<{ users: number; projects: number }> {
  if (!pattern.startsWith(E2E_EMAIL_PREFIX) || !pattern.endsWith(E2E_EMAIL_DOMAIN)) {
    throw new Error(`refusing to delete accounts like "${pattern}": not an e2e email`)
  }
  const statement = sql`
    with doomed as (select id from "user" where email like ${pattern}),
    cleared as (
      select 1 where
        (select left(md5(coalesce(string_agg(id, ',' order by id collate "C"), '')), ${FINGERPRINT_LENGTH}) from doomed) = ${fingerprint}
        and not exists (select 1 from quotes q where q.user_id in (select id from doomed))
    ),
    gone_projects as (
      delete from projects where user_id in (select id from doomed) and exists (select 1 from cleared) returning 1
    ),
    gone_users as (
      delete from "user" where id in (select id from doomed) and exists (select 1 from cleared) returning 1
    )
    select (select count(*)::int from gone_users) as users, (select count(*)::int from gone_projects) as projects`
  try {
    const [[deleted]] = await sql.transaction([statement], { isolationLevel: 'RepeatableRead' })
    return { users: deleted.users as number, projects: deleted.projects as number }
  } catch (error) {
    if (!isSerializationFailure(error)) throw error
    throw new Error(
      'Nothing deleted: one of these accounts was written to while the delete ran (an upload, a sign-in, a saved project). Run it again once no e2e run uses this database.',
      { cause: error },
    )
  }
}
