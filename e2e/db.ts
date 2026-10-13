import { neon, Pool } from '@neondatabase/serverless'
import type { ProductOrigin } from '../src/lib/product-schema'
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

/** Whether the appliance is in this run's database, read on the test's own connection: where the server really wrote. */
export async function testApplianceExists(id: string): Promise<boolean> {
  const rows = await testDb()`select 1 from appliances where id = ${id}`
  return rows.length > 0
}

/** Product helpers only touch keys of the "E2E …" brand, so a wrong key never reaches a real product. */
function assertTestProductKey(key: string): void {
  if (!/^(inverter|battery):e2e:/.test(key)) throw new Error(`refusing to touch "${key}": not an e2e product key`)
}

/** Deletes a product a test created. Deleting nothing (never created) is fine. */
export async function deleteTestProduct(key: string): Promise<void> {
  assertTestProductKey(key)
  await testDb()`delete from products where key = ${key}`
}

/** Adds a product row that fails the schema (empty `specs`), as one edited by hand would. Its model is the key's. */
export async function insertUnreadableTestProduct(key: string): Promise<void> {
  assertTestProductKey(key)
  const model = key.split(':')[2] ?? key
  const origin = 'admin' satisfies ProductOrigin
  await testDb()`
    insert into products (kind, key, brand, model, datasheet_url, specs, origin, updated_by)
    values ('inverter', ${key}, 'E2E Power', ${model}, 'https://example.com/e2e-datasheet.pdf', '{}'::jsonb, ${origin}, 'e2e')`
}

/** A product row as stored, undecoded: what a write must leave alone. Null when there is no such row. */
export async function rawTestProduct(key: string): Promise<{ specs: unknown; updatedBy: string } | null> {
  assertTestProductKey(key)
  const rows = await testDb()`select specs, updated_by from products where key = ${key}`
  return rows[0] ? { specs: rows[0].specs, updatedBy: rows[0].updated_by as string } : null
}

/** When a product row was last changed and last seen: a product sent again unchanged must move only the second. Null when there is no such row. */
export async function testProductDates(key: string): Promise<{ updatedAt: Date; lastSeenAt: Date } | null> {
  assertTestProductKey(key)
  const rows = await testDb()`select updated_at, last_seen_at from products where key = ${key}`
  return rows[0] ? { updatedAt: new Date(rows[0].updated_at), lastSeenAt: new Date(rows[0].last_seen_at) } : null
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

/**
 * Turns a project's quotes back into readings made before options existed: no options, no line options, and waiting
 * for a total, as the user's SUNA quote was stored.
 */
export async function stripQuoteOptions(email: string, projectId: string): Promise<void> {
  await testDb()`
    update quotes q set status = 'needs_review',
      extraction = jsonb_set(q.extraction - 'options', '{lines}',
        coalesce((select jsonb_agg(l - 'option') from jsonb_array_elements(q.extraction -> 'lines') l), '[]'::jsonb))
    from "user" u where u.id = q.user_id and u.email = ${email} and q.project_id = ${projectId}`
}

/** Sets the total the user typed on every quote of a project, as if they had saved it on the card. */
export async function setQuoteTotalOverride(email: string, projectId: string, total: number): Promise<void> {
  await testDb()`
    update quotes q set total_override = ${total}
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
 * Runs `text` in a transaction of its own and keeps that transaction open until `release` rolls it back, so whatever
 * the statement locked stays locked. The HTTP driver can't keep a transaction open between calls, so this uses a
 * WebSocket connection. With `lockTimeoutMs`, a statement still waiting for its lock after that long fails
 * (isLockTimeout) and nothing is left open.
 */
async function lockUntilReleased(
  text: string, params: unknown[], lockTimeoutMs?: number,
): Promise<{ rows: Record<string, unknown>[]; release: () => Promise<void> }> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  const release = async (): Promise<void> => {
    try {
      await client.query('rollback')
    } finally {
      client.release()
      await pool.end()
    }
  }
  try {
    await client.query('begin')
    if (lockTimeoutMs !== undefined) await client.query(`select set_config('lock_timeout', $1, true)`, [`${lockTimeoutMs}ms`])
    const { rows } = await client.query(text, params)
    return { rows, release }
  } catch (error) {
    // The statement's error is the one to report; a rollback that fails after it would only hide it.
    await release().catch(() => undefined)
    throw error
  }
}

/** Postgres's code for a statement that gave up waiting for a lock (lock_not_available). */
const LOCK_TIMEOUT_CODE = '55P03'
const isLockTimeout = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === LOCK_TIMEOUT_CODE

/**
 * Locks one quote row until `release`, so statements that touch the row wait for it. `pid` is the backend that holds
 * the lock: it tells the statements waiting on this row from the ones waiting on any other test's
 * (retryStatementsBehind).
 */
export async function holdQuoteRow(id: string): Promise<{ pid: number; release: () => Promise<void> }> {
  const { rows, release } = await lockUntilReleased('select pg_backend_pid() as pid from quotes where id = $1::uuid for update', [id])
  if (!rows[0]) {
    await release()
    throw new Error(`no quote ${id} to hold`)
  }
  return { pid: rows[0].pid as number, release }
}

/**
 * How many retry statements (the only statements with a `retried` CTE) wait behind the lock that backend `holderPid`
 * holds: on the lock itself, or in line behind a statement that does (the second retry of a quote waits for the
 * first, not for the holder). Other tests, and other runs on this database, queue retries behind locks of their own at
 * the same moment; those are not counted.
 */
export async function retryStatementsBehind(holderPid: number): Promise<number> {
  const rows = await testDb()`
    with recursive behind as (
      select a.pid, a.query from pg_stat_activity a where ${holderPid}::int = any(pg_blocking_pids(a.pid))
      union
      select a.pid, a.query from pg_stat_activity a join behind b on b.pid = any(pg_blocking_pids(a.pid))
    )
    select count(*)::int as n from behind where query like '%retried as (%'`
  return rows[0]!.n as number
}

/**
 * How long a copy waits for its turn. A turn lasts a few seconds, so a wait this long means a long line of copies or,
 * more likely, one that stalled while holding the turn (a paused debugger, a laptop asleep).
 */
const TURN_WAIT_MS = 30_000

/**
 * Waits for the turn named `name`, then holds it until `release`: a transaction-scoped advisory lock, so copies of a
 * test that run at the same moment (the desktop and phone projects, another checkout, CI: all on this database) go one
 * after the other. A copy that dies drops its connection, which ends its turn. One that stalls keeps it, so after
 * TURN_WAIT_MS the caller goes ahead without the turn. Use a turn only where going without one can make the test fail
 * when it should pass, never pass when it should fail: another copy's reads can hide the single read the race looks
 * for, not fake it. The two-key form shares nothing with the app's one-key locks (lockUserQuotes).
 */
export async function takeTurn(name: string): Promise<{ release: () => Promise<void> }> {
  try {
    const { release } = await lockUntilReleased(`select pg_advisory_xact_lock(hashtext('e2e-turn'), hashtext($1))`, [name], TURN_WAIT_MS)
    return { release }
  } catch (error) {
    if (!isLockTimeout(error)) throw error
    console.warn(`[e2e] still no turn "${name}" after ${TURN_WAIT_MS / 1000} s (a copy holding it has probably stalled): going ahead without it`)
    return { release: async () => undefined }
  }
}
