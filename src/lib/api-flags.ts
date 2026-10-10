export type WriteFlags = { ok: true; dryRun: boolean; replace: boolean } | { ok: false; error: string }

const FLAG_NAMES: ReadonlySet<string> = new Set(['dryRun', 'replace'])
const refuse = (error: string): WriteFlags => ({ ok: false, error })
const isBoolean = (value: string | undefined) => value === 'true' || value === 'false'

/**
 * The flags of a write request. Only `dryRun` and `replace` are accepted, each at most once and only as `true` or `false`,
 * so a mistyped flag is refused instead of falling through to a real write.
 */
export function parseWriteFlags(params: URLSearchParams): WriteFlags {
  const unknown = [...params.keys()].find((name) => !FLAG_NAMES.has(name))
  if (unknown !== undefined) return refuse(`Unknown query parameter "${unknown}"; use dryRun or replace, each true or false`)
  const bad = [...FLAG_NAMES].find((name) => {
    const values = params.getAll(name)
    return values.length > 1 || (values.length === 1 && !isBoolean(values[0]))
  })
  if (bad !== undefined) return refuse(`Query parameter "${bad}" must be given once, as true or false`)
  return { ok: true, dryRun: params.get('dryRun') === 'true', replace: params.get('replace') === 'true' }
}
