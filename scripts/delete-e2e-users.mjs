// Lists, and with --yes deletes, the accounts e2e runs left behind: only emails of the form e2e-…@example.com,
// with their sessions, sign-in methods and projects.
//
//   node --env-file=<env file> scripts/delete-e2e-users.mjs                     list only (read-only)
//   node --env-file=<env file> scripts/delete-e2e-users.mjs --yes=<fingerprint>  delete exactly the listed accounts
//
// <fingerprint> is printed by the listing and covers the exact set of listed account ids. The delete is one statement
// that removes nothing when the matching accounts no longer have that fingerprint (one appeared or disappeared since
// the listing), or when any of them has a quote: a quote's uploaded file is only removed from storage by the app's
// own delete, so those accounts are left for it. Projects carry no foreign key to their account, which is why they
// are deleted here by hand; sessions, sign-in methods and usage counters go with the account.
import { createHash } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

/** Every e2e sign-up uses this shape. example.com is reserved (RFC 2606), so no real mailbox has such an address. */
const E2E_EMAIL_PATTERN = 'e2e-%@example.com'
const FINGERPRINT_LENGTH = 12
/** How many accounts the listing shows by email: the oldest verified ones and the newest of all. The summary counts every one. */
const VERIFIED_SHOWN = 20
const NEWEST_SHOWN = 5

function parseFingerprint(argv) {
  const flag = argv.find((a) => a.startsWith('--yes'))
  if (!flag) return null
  const fingerprint = flag.split('=')[1] ?? ''
  if (!new RegExp(`^[0-9a-f]{${FINGERPRINT_LENGTH}}$`).test(fingerprint)) {
    throw new Error('--yes needs the fingerprint the listing printed, e.g. --yes=0123456789ab')
  }
  return fingerprint
}

/** Same value as the delete's SQL check: md5 of the ids in byte order (collate "C"), joined by commas. */
function fingerprintOf(ids) {
  return createHash('md5').update([...ids].sort().join(',')).digest('hex').slice(0, FINGERPRINT_LENGTH)
}

/** The Neon endpoint id ("ep-…"), so the output names the target database without printing the connection string. */
function endpointId(url) {
  return new URL(url).hostname.split('.')[0].replace(/-pooler$/, '')
}

const isoDay = (value) => new Date(value).toISOString().slice(0, 10)

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Pass the env file with node --env-file=<path>.')
  const confirmed = parseFingerprint(process.argv.slice(2))
  const sql = neon(url)

  const users = await sql`
    select u.id, u.email, u.email_verified as verified, u.created_at,
      (select count(*)::int from projects p where p.user_id = u.id) as projects,
      (select count(*)::int from quotes q where q.user_id = u.id) as quotes
    from "user" u where u.email like ${E2E_EMAIL_PATTERN} order by u.created_at`
  const [{ total }] = await sql`select count(*)::int as total from "user"`
  const fingerprint = fingerprintOf(users.map((u) => u.id))
  const verified = users.filter((u) => u.verified)
  const withQuotes = users.filter((u) => u.quotes > 0)
  const projects = users.reduce((sum, u) => sum + u.projects, 0)
  const row = (u) => ({ email: u.email, verified: u.verified, created: isoDay(u.created_at), projects: u.projects, quotes: u.quotes })

  console.log(`Database endpoint: ${endpointId(url)}`)
  console.log(`${users.length} of ${total} accounts match ${E2E_EMAIL_PATTERN}, with ${projects} projects; ${total - users.length} other accounts are untouched.`)
  if (users.length > 0) {
    console.log(`Created from ${isoDay(users[0].created_at)} to ${isoDay(users.at(-1).created_at)}. Verified (may start quote reads): ${verified.length}.`)
    if (verified.length > 0) {
      console.log(`The ${Math.min(VERIFIED_SHOWN, verified.length)} oldest verified:`)
      console.table(verified.slice(0, VERIFIED_SHOWN).map(row))
    }
    console.log(`The ${Math.min(NEWEST_SHOWN, users.length)} newest:`)
    console.table(users.slice(-NEWEST_SHOWN).map(row))
  }
  if (withQuotes.length > 0) {
    const shown = withQuotes.slice(0, NEWEST_SHOWN).map((u) => u.email).join(', ')
    console.log(`${withQuotes.length} of them have quotes, so nothing will be deleted until those are removed in the app. The first: ${shown}`)
  }

  if (confirmed === null) {
    if (users.length > 0 && withQuotes.length === 0) console.log(`\nList only. To delete exactly these accounts and their projects: add --yes=${fingerprint}`)
    return
  }
  const [deleted] = await sql`
    with doomed as (select id from "user" where email like ${E2E_EMAIL_PATTERN}),
    cleared as (
      select 1 where
        (select left(md5(coalesce(string_agg(id, ',' order by id collate "C"), '')), ${FINGERPRINT_LENGTH}) from doomed) = ${confirmed}
        and not exists (select 1 from quotes q where q.user_id in (select id from doomed))
    ),
    gone_projects as (
      delete from projects where user_id in (select id from doomed) and exists (select 1 from cleared) returning 1
    ),
    gone_users as (
      delete from "user" where id in (select id from doomed) and exists (select 1 from cleared) returning 1
    )
    select (select count(*)::int from gone_users) as users, (select count(*)::int from gone_projects) as projects`
  if (deleted.users === 0) {
    throw new Error('Nothing deleted: the matching accounts changed since that listing, or one of them has a quote. List again.')
  }
  console.log(`\nDeleted ${deleted.users} accounts and ${deleted.projects} projects.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
