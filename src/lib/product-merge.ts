import { extraNameKey, MAX_EXTRA_SPECS, productKey, type ExtraSpec, type ProductConflict, type ProductInput, type ProductKind, type ProductRecord } from './product-schema'
import { stable } from './stable-json'

/** A field and the two values a write weighed: the stored one and the one found. Used for both `replaced` and `conflicts`. */
export interface FieldChange { field: string; stored: unknown; found: unknown }
export type ChangeStatus = 'new' | 'updated' | 'conflicts' | 'unchanged'
/**
 * `refreshed` lists fields whose value stayed while replace took a new source (and its words); `removed` the fields an explicit
 * clear emptied; `cleared` the fields whose stored conflicts went. `dropped` lists new extra lines not stored because the
 * product already holds the maximum; it never changes the status.
 */
export interface ProductChange {
  key: string; kind: ProductKind; brand: string; model: string; status: ChangeStatus
  fills: string[]; replaced: FieldChange[]; refreshed: string[]; removed: string[]; cleared: string[]; conflicts: FieldChange[]; dropped: string[]
}
/** What a write does to one product: the change to report, the product to store and the row's conflicts list. */
export interface MergeResult { change: ProductChange; next: ProductInput; conflicts: ProductConflict[] }

/** What deciding some fields produced: which were filled, replaced, refreshed or confirmed (same value and source, replace on), the conflicts found and the new extra lines dropped. */
interface Outcome {
  fills: string[]; replaced: FieldChange[]; refreshed: string[]; confirmed: string[]; conflicts: FieldChange[]; found: ProductConflict[]; dropped: string[]
}
interface Decided<T> { value: T; outcome: Outcome }
/** `clear`: fields to empty, honoured only with replace (parseProducts refuses a clear of a field the item states). */
interface Ctx { replace: boolean; now: string; clear?: readonly string[] }
/** A field as stored or found: `shown` is the value as given, `comparable` the form it is compared in, `provenance` the source(s) it was read on. */
interface Field { comparable: unknown; shown: unknown; isStated: boolean; source: string | null; provenance: unknown }
interface Level { w: number | null; seconds: number | null }

const NOTHING: Outcome = { fills: [], replaced: [], refreshed: [], confirmed: [], conflicts: [], found: [], dropped: [] }
const UNSTATED: Field = { comparable: null, shown: null, isStated: false, source: null, provenance: null }
const combine = (a: Outcome, b: Outcome): Outcome => ({
  fills: [...a.fills, ...b.fills], replaced: [...a.replaced, ...b.replaced], refreshed: [...a.refreshed, ...b.refreshed], confirmed: [...a.confirmed, ...b.confirmed],
  conflicts: [...a.conflicts, ...b.conflicts], found: [...a.found, ...b.found], dropped: [...a.dropped, ...b.dropped],
})
const keep = <T>(value: T): Decided<T> => ({ value, outcome: NOTHING })
const sortedLower = (xs: readonly string[]) => [...xs].map((x) => x.toLowerCase()).sort()

const rank = (n: number | null) => n ?? -Infinity
const byLevel = (a: Level, b: Level) => (rank(a.w) - rank(b.w)) || (rank(a.seconds) - rank(b.seconds))

/** The form values compare in: string lists lowercased and sorted, surge levels as sorted [watts, seconds] pairs, text trimmed. */
function comparableOf(v: unknown): unknown {
  if (typeof v === 'string') return v.trim()
  if (!Array.isArray(v)) return v
  return v.every((x) => typeof x === 'string') ? sortedLower(v) : [...(v as Level[])].sort(byLevel).map((l) => [l.w, l.seconds])
}

/** Surge levels' sources, in level order; a list of plain strings has none. */
const listProvenance = (v: readonly unknown[]): unknown =>
  v.every((x) => typeof x === 'string') ? null : [...(v as Array<Level & { source: string }>)].sort(byLevel).map((l) => l.source)

function read(v: unknown): Field {
  if (v === undefined) return UNSTATED
  if (Array.isArray(v)) {
    const source = (v[0] as { source?: string } | undefined)?.source ?? null
    return { comparable: comparableOf(v), shown: v, isStated: v.length > 0, source, provenance: listProvenance(v) }
  }
  const s = v as { value: unknown; source: string | null }
  return { comparable: s.value, shown: s.value, isStated: s.value !== null, source: s.source, provenance: s.source }
}

/**
 * One field: keep the stored value, fill a stored null, replace it, or keep it and record a conflict. With replace on, a
 * same value is confirmed, or refreshed when its source differs: the incoming source and words are taken.
 */
function decide<T>(field: string, stored: T, incoming: T, a: Field, b: Field, ctx: Ctx): Decided<T> {
  if (!b.isStated) return keep(stored)
  if (!a.isStated) return { value: incoming, outcome: { ...NOTHING, fills: [field] } }
  if (stable(a.comparable) === stable(b.comparable)) {
    if (!ctx.replace) return keep(stored)
    if (stable(a.provenance) !== stable(b.provenance)) return { value: incoming, outcome: { ...NOTHING, refreshed: [field] } }
    return { value: stored, outcome: { ...NOTHING, confirmed: [field] } }
  }
  if (ctx.replace) return { value: incoming, outcome: { ...NOTHING, replaced: [{ field, stored: a.shown, found: b.shown }] } }
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
  ({ comparable: l?.value.trim() ?? null, shown: l?.value ?? null, isStated: l !== undefined, source: l?.source ?? null, provenance: l?.source ?? null })

/** Extra lines by name (case-insensitive): known names decide like specs and keep their stored name, new names are fills once each up to the cap of 8 and the rest are dropped. */
function mergeExtras(stored: readonly ExtraSpec[], incoming: readonly ExtraSpec[], ctx: Ctx): Decided<ExtraSpec[]> {
  const known = stored.map((line) => {
    const other = incoming.find((l) => extraNameKey(l.name) === extraNameKey(line.name))
    const found = other === undefined ? line : { ...line, value: other.value, source: other.source }
    return decide(`extraSpecs.${line.name}`, line, found, extraField(line), extraField(other), ctx)
  })
  const fresh = incoming
    .filter((l) => !stored.some((s) => extraNameKey(s.name) === extraNameKey(l.name)))
    .filter((l, i, all) => all.findIndex((o) => extraNameKey(o.name) === extraNameKey(l.name)) === i)
  const room = Math.max(0, MAX_EXTRA_SPECS - stored.length)
  const added = fresh.slice(0, room)
  const fieldOf = (l: ExtraSpec) => `extraSpecs.${l.name}`
  const addedOutcome: Outcome = { ...NOTHING, fills: added.map(fieldOf), dropped: fresh.slice(room).map(fieldOf) }
  return { value: [...known.map((d) => d.value), ...added], outcome: [...known.map((d) => d.outcome), addedOutcome].reduce(combine, NOTHING) }
}

/** The fields this write settled (filled, replaced, refreshed, confirmed or removed): their stored conflicts go. */
const settledFields = (o: Outcome, removed: readonly string[]): ReadonlySet<string> =>
  new Set([...o.fills, ...o.replaced.map((r) => r.field), ...o.refreshed, ...o.confirmed, ...removed])

/** The fields whose stored conflicts this write removes, each once. */
const clearedFields = (stored: readonly ProductConflict[], settled: ReadonlySet<string>): string[] =>
  [...new Set(stored.filter((c) => settled.has(c.field)).map((c) => c.field))]

/** The row's conflicts after this write: settled fields leave, new readings join once per field and value. */
function nextConflicts(stored: readonly ProductConflict[], o: Outcome, settled: ReadonlySet<string>): ProductConflict[] {
  const kept = stored.filter((c) => !settled.has(c.field))
  const isSame = (a: ProductConflict, b: ProductConflict) => a.field === b.field && stable(comparableOf(a.found)) === stable(comparableOf(b.found))
  return [...kept, ...o.found.filter((c) => !kept.some((k) => isSame(k, c)))]
}

function statusOf(o: Outcome, removed: readonly string[], cleared: readonly string[]): ChangeStatus {
  if ([o.fills, o.replaced, o.refreshed, removed, cleared].some((list) => list.length > 0)) return 'updated'
  return o.conflicts.length > 0 ? 'conflicts' : 'unchanged'
}

/** A price is dated and secondary, so a different one takes the old one's place even without replace; it is reported as replaced, not as a fill. */
function decidePrice(stored: ProductInput['price'], incoming: ProductInput['price']): Decided<ProductInput['price']> {
  if (incoming === null || stable(incoming) === stable(stored)) return keep(stored)
  if (stored === null) return { value: incoming, outcome: { ...NOTHING, fills: ['price'] } }
  return { value: incoming, outcome: { ...NOTHING, replaced: [{ field: 'price', stored, found: incoming }] } }
}

/** The empty form of a spec: no list items, or a value with neither source nor words. */
const emptySpec = (s: unknown): unknown => (Array.isArray(s) ? [] : { value: null, source: null, asWritten: null })

/** Empties each field in `clear` that holds something, naming it as stored (an extra line keeps its stored name). */
function applyClear(product: ProductInput, clear: readonly string[]): { next: ProductInput; removed: string[] } {
  return clear.reduce(({ next, removed }, path) => {
    if ((path === 'makerUrl' || path === 'price') && next[path] !== null) return { next: { ...next, [path]: null }, removed: [...removed, path] }
    if (path.startsWith('specs.')) {
      const name = path.slice('specs.'.length)
      const spec = (next.specs as Record<string, unknown>)[name]
      if (spec === undefined || !read(spec).isStated) return { next, removed }
      return { next: { ...next, specs: { ...next.specs, [name]: emptySpec(spec) } } as ProductInput, removed: [...removed, path] }
    }
    const line = path.startsWith('extraSpecs.') ? next.extraSpecs.find((l) => extraNameKey(l.name) === extraNameKey(path.slice('extraSpecs.'.length))) : undefined
    if (!line) return { next, removed }
    return { next: { ...next, extraSpecs: next.extraSpecs.filter((l) => l !== line) }, removed: [...removed, `extraSpecs.${line.name}`] }
  }, { next: product, removed: [] as string[] })
}

export function mergeProduct(stored: ProductRecord | null, incoming: ProductInput, ctx: Ctx): MergeResult {
  const key = productKey(incoming)
  if (stored === null) {
    const change: ProductChange = {
      key, kind: incoming.kind, brand: incoming.brand, model: incoming.model, status: 'new', fills: [], replaced: [], refreshed: [], removed: [], cleared: [], conflicts: [], dropped: [],
    }
    return { change, next: incoming, conflicts: [] }
  }
  const url = (u: string | null): Field => ({ comparable: u, shown: u, isStated: u !== null, source: u, provenance: null })
  const specs = mergeSpecs(stored.specs as Record<string, unknown>, incoming.specs as Record<string, unknown>, ctx)
  const makerUrl = decide('makerUrl', stored.makerUrl, incoming.makerUrl, url(stored.makerUrl), url(incoming.makerUrl), ctx)
  const datasheetUrl = decide('datasheetUrl', stored.datasheetUrl, incoming.datasheetUrl, url(stored.datasheetUrl), url(incoming.datasheetUrl), ctx)
  const extraSpecs = mergeExtras(stored.extraSpecs, incoming.extraSpecs, ctx)
  const price = decidePrice(stored.price, incoming.price)
  const outcome = [specs, makerUrl, datasheetUrl, extraSpecs, price].map((d) => d.outcome).reduce(combine, NOTHING)
  const merged = {
    kind: stored.kind, brand: stored.brand, model: stored.model, makerUrl: makerUrl.value, datasheetUrl: datasheetUrl.value,
    extraSpecs: extraSpecs.value, price: price.value, specs: specs.value,
  } as ProductInput
  const { next, removed } = ctx.replace ? applyClear(merged, ctx.clear ?? []) : { next: merged, removed: [] }
  const settled = settledFields(outcome, removed)
  const cleared = clearedFields(stored.conflicts, settled)
  const change: ProductChange = {
    key, kind: stored.kind, brand: stored.brand, model: stored.model, status: statusOf(outcome, removed, cleared),
    fills: outcome.fills, replaced: outcome.replaced, refreshed: outcome.refreshed, removed, cleared, conflicts: outcome.conflicts, dropped: outcome.dropped,
  }
  return { change, next, conflicts: nextConflicts(stored.conflicts, outcome, settled) }
}

/** Whether a write puts something different in the row: a fill, a replace, a refreshed source or a clear. A kept conflict or a confirmed value does not. */
export const changesStoredValues = (change: ProductChange): boolean =>
  [change.fills, change.replaced, change.refreshed, change.removed].some((list) => list.length > 0)

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
