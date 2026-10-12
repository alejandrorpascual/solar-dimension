export type WriteFlags<Name extends string> = ({ ok: true } & Record<Name, boolean>) | { ok: false; error: string }

const isBoolean = (value: string | undefined) => value === 'true' || value === 'false'

/** What a refusal tells the caller to send instead. */
const accepted = (names: readonly string[]): string =>
  names.length === 0 ? 'this request takes no query parameters'
  : names.length === 1 ? `use ${names[0]}, as true or false`
  : `use ${names.join(' or ')}, each true or false`

/**
 * The flags of a write request. Only `names` are accepted, each at most once and only as `true` or `false`, so a
 * mistyped flag, or one the route does not have, is refused instead of falling through to a real write.
 */
export function parseWriteFlags<const Name extends string>(params: URLSearchParams, names: readonly Name[]): WriteFlags<Name> {
  const unknown = [...params.keys()].find((name) => !names.some((known) => known === name))
  if (unknown !== undefined) return { ok: false, error: `Unknown query parameter "${unknown}"; ${accepted(names)}` }
  const bad = names.find((name) => {
    const values = params.getAll(name)
    return values.length > 1 || (values.length === 1 && !isBoolean(values[0]))
  })
  if (bad !== undefined) return { ok: false, error: `Query parameter "${bad}" must be given once, as true or false` }
  const flags = Object.fromEntries(names.map((name) => [name, params.get(name) === 'true'])) as Record<Name, boolean>
  return { ok: true, ...flags }
}
