import { MAX_EXTRA_SPECS, productKey, type ExtraSpec, type ProductConflict, type ProductInput, type ProductKind, type ProductRecord } from './product-schema'
import { stable } from './stable-json'

export interface FieldConflict { field: string; stored: unknown; found: unknown }
export type ChangeStatus = 'new' | 'updated' | 'conflicts' | 'unchanged'
export interface ProductChange {
  key: string; kind: ProductKind; brand: string; model: string; status: ChangeStatus
  fills: string[]; replaced: string[]; cleared: string[]; conflicts: FieldConflict[]
}
/** What a write does to one product: the change to report, the product to store and the row's conflicts list. */
export interface MergeResult { change: ProductChange; next: ProductInput; conflicts: ProductConflict[] }

/** What deciding some fields produced: which were filled, replaced or confirmed (same value, replace on), and the conflicts found. */
interface Outcome { fills: string[]; replaced: string[]; confirmed: string[]; conflicts: FieldConflict[]; found: ProductConflict[] }
interface Decided<T> { value: T; outcome: Outcome }
interface Ctx { replace: boolean; now: string }
/** A field as stored or found: `shown` is the value as given, `comparable` the form it is compared in. */
interface Field { comparable: unknown; shown: unknown; isStated: boolean; source: string | null }
interface Level { w: number | null; seconds: number | null }

const NOTHING: Outcome = { fills: [], replaced: [], confirmed: [], conflicts: [], found: [] }
const UNSTATED: Field = { comparable: null, shown: null, isStated: false, source: null }
const combine = (a: Outcome, b: Outcome): Outcome => ({
  fills: [...a.fills, ...b.fills], replaced: [...a.replaced, ...b.replaced], confirmed: [...a.confirmed, ...b.confirmed],
  conflicts: [...a.conflicts, ...b.conflicts], found: [...a.found, ...b.found],
})
const keep = <T>(value: T): Decided<T> => ({ value, outcome: NOTHING })
const sortedLower = (xs: readonly string[]) => [...xs].map((x) => x.toLowerCase()).sort()
const nameKey = (s: string) => s.trim().toLowerCase()

const rank = (n: number | null) => n ?? -Infinity
const byLevel = (a: Level, b: Level) => (rank(a.w) - rank(b.w)) || (rank(a.seconds) - rank(b.seconds))

/** The form values compare in: string lists lowercased and sorted, surge levels as sorted [watts, seconds] pairs, text trimmed. */
function comparableOf(v: unknown): unknown {
  if (typeof v === 'string') return v.trim()
  if (!Array.isArray(v)) return v
  return v.every((x) => typeof x === 'string') ? sortedLower(v) : [...(v as Level[])].sort(byLevel).map((l) => [l.w, l.seconds])
}

function read(v: unknown): Field {
  if (v === undefined) return UNSTATED
  if (Array.isArray(v)) {
    return { comparable: comparableOf(v), shown: v, isStated: v.length > 0, source: (v[0] as { source?: string } | undefined)?.source ?? null }
  }
  const s = v as { value: unknown; source: string | null }
  return { comparable: s.value, shown: s.value, isStated: s.value !== null, source: s.source }
}

/** One field: keep the stored value, fill a stored null, replace it, or keep it and record a conflict. With replace on, a same value is confirmed. */
function decide<T>(field: string, stored: T, incoming: T, a: Field, b: Field, ctx: Ctx): Decided<T> {
  if (!b.isStated) return keep(stored)
  if (!a.isStated) return { value: incoming, outcome: { ...NOTHING, fills: [field] } }
  if (stable(a.comparable) === stable(b.comparable)) {
    return ctx.replace ? { value: stored, outcome: { ...NOTHING, confirmed: [field] } } : keep(stored)
  }
  if (ctx.replace) return { value: incoming, outcome: { ...NOTHING, replaced: [field] } }
  return {
    value: stored,
    outcome: {
      ...NOTHING,
      conflicts: [{ field, stored: a.shown, found: b.shown }],
      found: [{ field, found: b.shown, source: b.source, seenAt: ctx.now }],
    },
  }
}

function mergeSpecs(stored: Record<string, unknown>, incoming: Record<string, unknown>, ctx: Ctx): Decided<Record<string, unknown>> {
  const decided = Object.keys(incoming).map((key) =>
    [key, decide(`specs.${key}`, stored[key], incoming[key], read(stored[key]), read(incoming[key]), ctx)] as const)
  return { value: Object.fromEntries(decided.map(([k, d]) => [k, d.value])), outcome: decided.map(([, d]) => d.outcome).reduce(combine, NOTHING) }
}

const extraField = (l: ExtraSpec | undefined): Field =>
  ({ comparable: l?.value.trim() ?? null, shown: l?.value ?? null, isStated: l !== undefined, source: l?.source ?? null })

/** Extra lines by name (case-insensitive): known names decide like specs and keep their stored name, new names are fills once each, never more than 8. */
function mergeExtras(stored: readonly ExtraSpec[], incoming: readonly ExtraSpec[], ctx: Ctx): Decided<ExtraSpec[]> {
  const known = stored.map((line) => {
    const other = incoming.find((l) => nameKey(l.name) === nameKey(line.name))
    const found = other === undefined ? line : { ...line, value: other.value, source: other.source }
    return decide(`extraSpecs.${line.name}`, line, found, extraField(line), extraField(other), ctx)
  })
  const added = incoming
    .filter((l) => !stored.some((s) => nameKey(s.name) === nameKey(l.name)))
    .filter((l, i, fresh) => fresh.findIndex((o) => nameKey(o.name) === nameKey(l.name)) === i)
    .slice(0, Math.max(0, MAX_EXTRA_SPECS - stored.length))
  const addedOutcome: Outcome = { ...NOTHING, fills: added.map((l) => `extraSpecs.${l.name}`) }
  return { value: [...known.map((d) => d.value), ...added], outcome: [...known.map((d) => d.outcome), addedOutcome].reduce(combine, NOTHING) }
}

const settledFields = (o: Outcome) => new Set([...o.fills, ...o.replaced, ...o.confirmed])

/** The fields whose stored conflicts this write removes, each once. */
const clearedFields = (stored: readonly ProductConflict[], o: Outcome): string[] =>
  [...new Set(stored.filter((c) => settledFields(o).has(c.field)).map((c) => c.field))]

/** The row's conflicts after this write: settled fields leave, new readings join once per field and value. */
function nextConflicts(stored: readonly ProductConflict[], o: Outcome): ProductConflict[] {
  const kept = stored.filter((c) => !settledFields(o).has(c.field))
  const isSame = (a: ProductConflict, b: ProductConflict) => a.field === b.field && stable(comparableOf(a.found)) === stable(comparableOf(b.found))
  return [...kept, ...o.found.filter((c) => !kept.some((k) => isSame(k, c)))]
}

function statusOf(o: Outcome, cleared: readonly string[]): ChangeStatus {
  if (o.fills.length > 0 || o.replaced.length > 0 || cleared.length > 0) return 'updated'
  return o.conflicts.length > 0 ? 'conflicts' : 'unchanged'
}

export function mergeProduct(stored: ProductRecord | null, incoming: ProductInput, ctx: Ctx): MergeResult {
  const key = productKey(incoming)
  if (stored === null) {
    const change: ProductChange = { key, kind: incoming.kind, brand: incoming.brand, model: incoming.model, status: 'new', fills: [], replaced: [], cleared: [], conflicts: [] }
    return { change, next: incoming, conflicts: [] }
  }
  const url = (u: string | null): Field => ({ comparable: u, shown: u, isStated: u !== null, source: u })
  const specs = mergeSpecs(stored.specs as Record<string, unknown>, incoming.specs as Record<string, unknown>, ctx)
  const makerUrl = decide('makerUrl', stored.makerUrl, incoming.makerUrl, url(stored.makerUrl), url(incoming.makerUrl), ctx)
  const datasheetUrl = decide('datasheetUrl', stored.datasheetUrl, incoming.datasheetUrl, url(stored.datasheetUrl), url(incoming.datasheetUrl), ctx)
  const extraSpecs = mergeExtras(stored.extraSpecs, incoming.extraSpecs, ctx)
  // Price is dated and secondary: a different one simply takes the old one's place.
  const price: Decided<ProductInput['price']> = incoming.price !== null && stable(incoming.price) !== stable(stored.price)
    ? { value: incoming.price, outcome: { ...NOTHING, fills: ['price'] } }
    : keep(stored.price)
  const outcome = [specs, makerUrl, datasheetUrl, extraSpecs, price].map((d) => d.outcome).reduce(combine, NOTHING)
  const next = {
    kind: stored.kind, brand: stored.brand, model: stored.model, makerUrl: makerUrl.value, datasheetUrl: datasheetUrl.value,
    extraSpecs: extraSpecs.value, price: price.value, specs: specs.value,
  } as ProductInput
  const cleared = clearedFields(stored.conflicts, outcome)
  const change: ProductChange = {
    key, kind: stored.kind, brand: stored.brand, model: stored.model, status: statusOf(outcome, cleared),
    fills: outcome.fills, replaced: outcome.replaced, cleared, conflicts: outcome.conflicts,
  }
  return { change, next, conflicts: nextConflicts(stored.conflicts, outcome) }
}

export interface UpsertSummary { created: string[]; updated: string[]; unchanged: string[]; conflicts: Array<{ key: string; fields: string[] }> }

/** What a write answers. `conflicts` lists every product whose change has conflicts, whatever its status: a write that fills one field and finds another differing is in `updated` too. */
export function summarize(changes: readonly ProductChange[]): UpsertSummary {
  const keysWith = (status: ChangeStatus) => changes.filter((c) => c.status === status).map((c) => c.key)
  return {
    created: keysWith('new'),
    updated: keysWith('updated'),
    unchanged: keysWith('unchanged'),
    conflicts: changes.filter((c) => c.conflicts.length > 0).map((c) => ({ key: c.key, fields: c.conflicts.map((f) => f.field) })),
  }
}
