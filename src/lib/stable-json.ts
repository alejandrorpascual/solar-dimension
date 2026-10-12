/**
 * JSON with object keys sorted, so two values compare equal as text whatever order their keys came in: jsonb hands
 * a stored record's keys back in its own order. A field the stored record never had (undefined) reads as null, the
 * same as the schema's default for it, so an old row and a new write of the same thing do not read as a change.
 */
export function stable(v: unknown): string {
  if (v === undefined || v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
}
