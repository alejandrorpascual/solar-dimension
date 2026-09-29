// Lists, and with --yes deletes, the catalog rows e2e runs left behind: only ids starting with "e2e-".
//
//   node --env-file=<env file> scripts/delete-e2e-appliances.mjs              list only (read-only)
//   node --env-file=<env file> scripts/delete-e2e-appliances.mjs --yes=<n>    delete, only if exactly <n> rows match
//
// <n> is the count the listing printed. The delete is one statement that removes nothing when the match count is not
// <n>, so a row that started to match after the listing (or a typo in <n>) never gets deleted unseen.
import { neon } from '@neondatabase/serverless'

const E2E_PREFIX = 'e2e-'

function parseExpectedCount(argv) {
  const flag = argv.find((a) => a.startsWith('--yes'))
  if (!flag) return null
  const n = Number(flag.split('=')[1])
  if (!Number.isInteger(n) || n < 1) throw new Error('--yes needs the row count from the listing, e.g. --yes=52')
  return n
}

/** The Neon endpoint id ("ep-…"), so the output names the target database without printing the connection string. */
function endpointId(url) {
  return new URL(url).hostname.split('.')[0].replace(/-pooler$/, '')
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Pass the env file with node --env-file=<path>.')
  const expected = parseExpectedCount(process.argv.slice(2))
  const sql = neon(url)

  const rows = await sql`
    select id, category, labels->'en'->>'name' as name, retired_at is not null as retired, created_at
    from appliances where starts_with(id, ${E2E_PREFIX}) order by created_at`
  const [{ total }] = await sql`select count(*)::int as total from appliances`
  const [{ projects }] = await sql`
    select count(*)::int as projects from projects p
    where exists (select 1 from jsonb_object_keys(p.qty) k where starts_with(k, ${E2E_PREFIX}))`

  console.log(`Database endpoint: ${endpointId(url)}`)
  console.table(rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() })))
  console.log(`${rows.length} of ${total} appliance rows start with "${E2E_PREFIX}"; ${total - rows.length} others are untouched.`)
  console.log(`Saved projects that include one of them: ${projects}`)

  if (expected === null) {
    console.log(`\nList only. To delete: add --yes=${rows.length}`)
    return
  }
  const deleted = await sql`
    with doomed as (select id from appliances where starts_with(id, ${E2E_PREFIX}))
    delete from appliances
    where id in (select id from doomed) and (select count(*) from doomed) = ${expected}
    returning id`
  if (deleted.length !== expected) {
    throw new Error(`Nothing deleted: ${rows.length} rows match now, but --yes said ${expected}. List again and re-check.`)
  }
  console.log(`\nDeleted ${deleted.length} rows.`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
