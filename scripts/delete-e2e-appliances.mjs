// Lists, and with --yes deletes, the catalog rows e2e runs left behind: only ids starting with "e2e-".
//
//   node --env-file=<env file> scripts/delete-e2e-appliances.mjs                    list only (read-only)
//   node --env-file=<env file> scripts/delete-e2e-appliances.mjs --yes=<fingerprint> delete exactly the listed rows
//
// <fingerprint> is printed by the listing and covers the exact set of listed ids. The delete is one statement that
// removes nothing when the matching ids no longer have that fingerprint (a row appeared or disappeared since the
// listing), or when any saved project uses one of them: project quantities keep ids without a foreign key, so
// deleting a used appliance would silently drop its load from that project's sizing.
import { createHash } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const E2E_PREFIX = 'e2e-'
const FINGERPRINT_LENGTH = 12

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

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Pass the env file with node --env-file=<path>.')
  const confirmed = parseFingerprint(process.argv.slice(2))
  const sql = neon(url)

  const rows = await sql`
    select id, category, labels->'en'->>'name' as name, retired_at is not null as retired, created_at
    from appliances where starts_with(id, ${E2E_PREFIX}) order by created_at`
  const [{ total }] = await sql`select count(*)::int as total from appliances`
  const fingerprint = fingerprintOf(rows.map((r) => r.id))
  const used = await sql`
    select distinct k as id from projects p, jsonb_object_keys(p.qty) k where starts_with(k, ${E2E_PREFIX}) order by k`

  console.log(`Database endpoint: ${endpointId(url)}`)
  console.table(rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })))
  console.log(`${rows.length} of ${total} appliance rows start with "${E2E_PREFIX}"; ${total - rows.length} others are untouched.`)
  if (used.length > 0) {
    console.log(`Used by saved projects, so nothing will be deleted until they are handled: ${used.map((u) => u.id).join(', ')}`)
  }

  if (confirmed === null) {
    if (rows.length > 0 && used.length === 0) console.log(`\nList only. To delete exactly these rows: add --yes=${fingerprint}`)
    return
  }
  const deleted = await sql`
    with doomed as (select id from appliances where starts_with(id, ${E2E_PREFIX}))
    delete from appliances
    where id in (select id from doomed)
      and (select left(md5(coalesce(string_agg(id, ',' order by id collate "C"), '')), ${FINGERPRINT_LENGTH}) from doomed) = ${confirmed}
      and not exists (select 1 from projects p, jsonb_object_keys(p.qty) k where starts_with(k, ${E2E_PREFIX}))
    returning id`
  if (deleted.length === 0) {
    throw new Error('Nothing deleted: the matching rows changed since that listing, or a saved project uses one. List again.')
  }
  console.log(`\nDeleted ${deleted.length} rows.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
