import type { ApplianceRecord } from './catalog-schema'

const COLUMNS = ['id', 'category', 'watts', 'surge', 'duty', 'tons', 'ac_type', 'labels', 'sort_order', 'updated_by']
const text = (s: string) => `'${s.replaceAll("'", "''")}'`
const orNull = <T>(v: T | null, f: (x: T) => string) => (v === null ? 'NULL' : f(v))

/** The seed migration's SQL. Re-running it is harmless: existing ids are left alone. */
export function seedSql(rows: readonly ApplianceRecord[]): string {
  const values = rows.map((r) =>
    `(${[
      text(r.id), text(r.category), r.watts, r.surge, r.duty,
      orNull(r.tons, String), orNull(r.acType, text),
      `${text(JSON.stringify(r.labels))}::jsonb`, r.sortOrder, text('seed'),
    ].join(', ')})`,
  )
  return `INSERT INTO "appliances" (${COLUMNS.map((c) => `"${c}"`).join(', ')}) VALUES\n${values.join(',\n')}\nON CONFLICT ("id") DO NOTHING;\n`
}
