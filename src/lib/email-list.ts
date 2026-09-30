/** A comma-separated list of emails from the environment, trimmed and lower-cased, blanks dropped. */
export function parseEmailList(raw: string | undefined): ReadonlySet<string> {
  return new Set((raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
}
