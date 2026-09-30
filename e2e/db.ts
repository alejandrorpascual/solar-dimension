import { neon, Pool } from '@neondatabase/serverless'
import { utcDay } from '../src/lib/quote-budget'

const TEST_APPLIANCE_PREFIX = 'e2e-'

function testDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is needed for e2e tests that touch the database')
  return neon(url)
}

/** Sign-up never verifies emails, and the admin check requires a verified one. Tests mark their admin by hand. */
export async function markEmailVerified(email: string): Promise<void> {
  await testDb()`update "user" set email_verified = true where email = ${email}`
}

/**
 * Deletes an appliance a test created. The API only retires (the row stays, so saved projects keep their numbers),
 * which left every run's rows behind; tests delete theirs outright. Only `e2e-` ids, so a wrong id never removes a
 * real item. Deleting nothing (never created) is fine.
 */
export async function deleteTestAppliance(id: string): Promise<void> {
  if (!id.startsWith(TEST_APPLIANCE_PREFIX)) throw new Error(`refusing to delete "${id}": not an e2e appliance id`)
  await testDb()`delete from appliances where id = ${id}`
}

/** The id of the user's first saved project. Projects are created in the browser and synced, so tests read the id back here. */
export async function firstProjectId(email: string): Promise<string> {
  const rows = await testDb()`select p.id from projects p join "user" u on u.id = p.user_id where u.email = ${email} order by p.created_at limit 1`
  if (!rows[0]) throw new Error(`no saved project for ${email}`)
  return rows[0].id as string
}

/**
 * Fills a project with `count` finished-with-failure quote rows (no file behind them), so the per-project limit can be
 * hit without uploading. "failed" rows are never picked up by the reader, and they count as live rows like any other.
 */
export async function seedQuoteRows(email: string, projectId: string, count: number): Promise<void> {
  await testDb()`
    insert into quotes (id, user_id, project_id, file_name, blob_pathname, mime, size_bytes, status, error)
    select gen_random_uuid(), u.id, ${projectId}, 'seed-' || n || '.pdf', 'e2e-seed/' || n, 'application/pdf', 1000, 'failed', 'seeded by e2e'
    from "user" u, generate_series(1, ${count}::int) n where u.email = ${email}`
}

/** Sets this UTC month's upload counter, which is what the monthly limit reads. */
export async function setQuoteUploadsThisMonth(email: string, uploads: number): Promise<void> {
  await testDb()`
    insert into quote_usage (user_id, month, uploads)
    select u.id, date_trunc('month', now() at time zone 'utc')::date, ${uploads}::int from "user" u where u.email = ${email}
    on conflict (user_id, month) do update set uploads = excluded.uploads`
}

export async function countQuoteRows(email: string, projectId: string): Promise<number> {
  const rows = await testDb()`select count(*)::int as n from quotes q join "user" u on u.id = q.user_id where u.email = ${email} and q.project_id = ${projectId}`
  return rows[0].n as number
}

/** Adds a copy of the user's first project under a new id, so a test has a project only this account can open. */
export async function cloneProject(email: string, newId: string): Promise<void> {
  await testDb()`
    insert into projects (id, user_id, name, qty, custom, hours, volts, chemistry, battery_unit)
    select ${newId}, p.user_id, p.name, p.qty, p.custom, p.hours, p.volts, p.chemistry, p.battery_unit
    from projects p join "user" u on u.id = p.user_id where u.email = ${email} order by p.created_at limit 1`
}

/** Sets the retries used by every quote of a project, so a test reaches the retry cap without waiting on real retries. */
export async function setQuoteRetries(email: string, projectId: string, retries: number): Promise<void> {
  await testDb()`
    update quotes q set retries = ${retries}::int
    from "user" u where u.id = q.user_id and u.email = ${email} and q.project_id = ${projectId}`
}

/** The status and retries of every quote of a project, oldest first. */
export async function quoteRetryStates(email: string, projectId: string): Promise<{ status: string; retries: number }[]> {
  const rows = await testDb()`
    select q.status, q.retries from quotes q join "user" u on u.id = q.user_id
    where u.email = ${email} and q.project_id = ${projectId} order by q.created_at`
  return rows.map((r) => ({ status: r.status as string, retries: r.retries as number }))
}

/** Every quote of the user, with its project and the path of its file in storage. */
export async function quoteFiles(email: string): Promise<{ projectId: string; path: string }[]> {
  const rows = await testDb()`
    select q.project_id, q.blob_pathname from quotes q join "user" u on u.id = q.user_id where u.email = ${email}`
  return rows.map((r) => ({ projectId: r.project_id as string, path: r.blob_pathname as string }))
}

/** Which of `paths` still wait in the trash for their file to leave storage. */
export async function trashedPaths(paths: string[]): Promise<string[]> {
  const rows = await testDb()`select pathname from quote_file_trash where pathname = any(${paths}::text[])`
  return rows.map((r) => r.pathname as string)
}

/**
 * Today's reads across every account, the counter the daily budget reads. The day comes from the same utcDay the
 * server uses, on this machine's clock, not the database's, so the two agree around UTC midnight.
 */
export async function dailyReads(): Promise<number> {
  const rows = await testDb()`select reads from quote_daily_usage where day = ${utcDay(new Date())}::date`
  return (rows[0]?.reads as number | undefined) ?? 0
}

/**
 * Raises today's read counter to at least `reads`, never lowers it: other tests and runs share the counter, and the
 * main E2E server's budget is far above anything a test sets here.
 */
export async function raiseDailyReadsTo(reads: number): Promise<void> {
  await testDb()`
    insert into quote_daily_usage (day, reads) values (${utcDay(new Date())}::date, ${reads}::int)
    on conflict (day) do update set reads = greatest(quote_daily_usage.reads, excluded.reads)`
}

/**
 * Adds a Google account row to the user, as Better Auth does when a user links Google or signs up with it, with the
 * id_token Google would give: its `email` is the user's, and `email_verified` says whether Google verified it. The
 * row leaves the user's `email_verified` as it was. The token is unsigned; the app reads only its payload.
 */
export async function linkGoogleAccount(email: string, { emailVerified = true }: { emailVerified?: boolean } = {}): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', email, email_verified: emailVerified })).toString('base64url')
  const idToken = `e30.${payload}.e2e-unsigned`
  await testDb()`
    insert into account (id, account_id, provider_id, user_id, id_token, created_at, updated_at)
    select 'e2e-google-' || u.id, 'e2e-google-sub-' || u.id, 'google', u.id, ${idToken}, now(), now() from "user" u where u.email = ${email}`
}

/** Adds one quote that could not be read (no file behind it, retries left), and returns its id. */
export async function seedFailedQuote(email: string, projectId: string, fileName: string): Promise<string> {
  const rows = await testDb()`
    insert into quotes (id, user_id, project_id, file_name, blob_pathname, mime, size_bytes, status, error)
    select gen_random_uuid(), u.id, ${projectId}, ${fileName}, 'e2e-seed/' || gen_random_uuid(), 'application/pdf', 1000, 'failed', 'seeded by e2e'
    from "user" u where u.email = ${email}
    returning id`
  return rows[0]!.id as string
}

export async function quoteRetryCount(id: string): Promise<number> {
  const rows = await testDb()`select retries from quotes where id = ${id}::uuid`
  return rows[0]!.retries as number
}

/**
 * Locks one quote row in a transaction of its own until `release`, so statements that touch the row wait for it. The
 * HTTP driver can't keep a transaction open between calls, so this uses a WebSocket connection.
 */
export async function holdQuoteRow(id: string): Promise<{ release: () => Promise<void> }> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  await client.query('begin')
  await client.query('select id from quotes where id = $1::uuid for update', [id])
  return {
    release: async () => {
      try {
        await client.query('rollback')
      } finally {
        client.release()
        await pool.end()
      }
    },
  }
}

/** How many retry statements (the only statements with a `retried` CTE) wait on a lock right now. */
export async function waitingRetryStatements(): Promise<number> {
  const rows = await testDb()`
    select count(*)::int as n from pg_stat_activity
    where wait_event_type = 'Lock' and query like '%retried as (%' and pid <> pg_backend_pid()`
  return rows[0]!.n as number
}
