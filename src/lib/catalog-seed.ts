import type { ApplianceRecord } from './catalog-schema'

/** The columns as of migration 0004; the first seed is kept byte for byte, so this list never grows. */
const COLUMNS = ['id', 'category', 'watts', 'surge', 'duty', 'tons', 'ac_type', 'labels', 'sort_order', 'updated_by']
/** Every column a later seed writes, the load-kind fields of migration 0011 included. */
const FULL_COLUMNS = [...COLUMNS, 'kind', 'surge_class', 'burst_seconds', 'cycles_per_hour']
const text = (s: string) => `'${s.replaceAll("'", "''")}'`
const orNull = <T>(v: T | null | undefined, f: (x: T) => string) => (v == null ? 'NULL' : f(v))

const baseValues = (r: ApplianceRecord): string[] => [
  text(r.id), text(r.category), String(r.watts), String(r.surge), String(r.duty),
  orNull(r.tons, String), orNull(r.acType, text),
  `${text(JSON.stringify(r.labels))}::jsonb`, String(r.sortOrder), text('seed'),
]

const insert = (columns: readonly string[], values: readonly string[][]): string =>
  `INSERT INTO "appliances" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES\n${values.map((v) => `(${v.join(', ')})`).join(',\n')}\nON CONFLICT ("id") DO NOTHING;\n`

/** The first seed migration's SQL. Re-running it is harmless: existing ids are left alone. */
export function seedSql(rows: readonly ApplianceRecord[]): string {
  return insert(COLUMNS, rows.map(baseValues))
}

/** A later seed's SQL, with the load-kind columns. */
export function seedSqlFull(rows: readonly ApplianceRecord[]): string {
  return insert(FULL_COLUMNS, rows.map((r) => [
    ...baseValues(r), orNull(r.kind, text), orNull(r.surgeClass, text), orNull(r.burstSeconds, String), orNull(r.cyclesPerHour, String),
  ]))
}
