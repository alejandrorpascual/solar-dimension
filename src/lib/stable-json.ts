/** JSON with object keys sorted, so jsonb's key reordering never reads as a change. Undefined reads as null. */
export function stable(v: unknown): string {
  if (v === undefined || v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
}
