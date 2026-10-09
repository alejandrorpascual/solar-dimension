import { productKey, type ExtraSpec, type ProductConflict, type ProductInput, type ProductKind, type ProductRecord } from './product-schema'
import { stable } from './stable-json'

const MAX_EXTRA_SPECS = 8

export interface FieldConflict { field: string; stored: unknown; found: unknown }
export type ChangeStatus = 'new' | 'updated' | 'conflicts' | 'unchanged'
export interface ProductChange {
  key: string; kind: ProductKind; brand: string; model: string; status: ChangeStatus
  fills: string[]; replaced: string[]; conflicts: FieldConflict[]
}
/** What a write does to one product: the change to report, the product to store and the row's conflicts list. */
export interface MergeResult { change: ProductChange; next: ProductInput; conflicts: ProductConflict[] }

/** What deciding some fields produced: which were filled or replaced, and the conflicts found. */
interface Outcome { fills: string[]; replaced: string[]; conflicts: FieldConflict[]; found: ProductConflict[] }
interface Decided<T> { value: T; outcome: Outcome }
interface Ctx { replace: boolean; now: string }
/** How a field compares: specs by value, surge levels by watts and seconds, lists sorted. */
interface Field { comparable: unknown; isStated: boolean; source: string | null }

const NOTHING: Outcome = { fills: [], replaced: [], conflicts: [], found: [] }
const combine = (a: Outcome, b: Outcome): Outcome => ({
  fills: [...a.fills, ...b.fills], replaced: [...a.replaced, ...b.replaced],
  conflicts: [...a.conflicts, ...b.conflicts], found: [...a.found, ...b.found],
})
const keep = <T>(value: T): Decided<T> => ({ value, outcome: NOTHING })
const sortedLower = (xs: readonly string[]) => [...xs].map((x) => x.toLowerCase()).sort()
const nameKey = (s: string) => s.trim().toLowerCase()

function read(key: string, v: unknown): Field {
  if (Array.isArray(v)) {
    const comparable = key === 'surges'
      ? (v as Array<{ w: number | null; seconds: number | null }>).map((l) => [l.w, l.seconds])
      : sortedLower(v as string[])
    return { comparable, isStated: v.length > 0, source: (v[0] as { source?: string } | undefined)?.source ?? null }
  }
  const s = v as { value: unknown; source: string | null }
  return { comparable: s.value, isStated: s.value !== null, source: s.source }
}

/** One field: keep the stored value, fill a stored null, replace it, or keep it and record a conflict. */
function decide<T>(field: string, stored: T, incoming: T, a: Field, b: Field, ctx: Ctx): Decided<T> {
  if (!b.isStated) return keep(stored)
  if (!a.isStated) return { value: incoming, outcome: { ...NOTHING, fills: [field] } }
  if (stable(a.comparable) === stable(b.comparable)) return keep(stored)
  if (ctx.replace) return { value: incoming, outcome: { ...NOTHING, replaced: [field] } }
  return {
    value: stored,
    outcome: {
      ...NOTHING,
      conflicts: [{ field, stored: a.comparable, found: b.comparable }],
      found: [{ field, found: b.comparable, source: b.source, seenAt: ctx.now }],
    },
  }
}

function mergeSpecs(stored: Record<string, unknown>, incoming: Record<string, unknown>, ctx: Ctx): Decided<Record<string, unknown>> {
  const decided = Object.keys(incoming).map((key) =>
    [key, decide(`specs.${key}`, stored[key], incoming[key], read(key, stored[key]), read(key, incoming[key]), ctx)] as const)
  return { value: Object.fromEntries(decided.map(([k, d]) => [k, d.value])), outcome: decided.map(([, d]) => d.outcome).reduce(combine, NOTHING) }
}

const extraField = (l: ExtraSpec | undefined): Field => ({ comparable: l?.value.trim() ?? null, isStated: l !== undefined, source: l?.source ?? null })

/** Extra lines by name (case-insensitive): known names decide like specs, new names are fills, never more than 8. */
function mergeExtras(stored: readonly ExtraSpec[], incoming: readonly ExtraSpec[], ctx: Ctx): Decided<ExtraSpec[]> {
  const known = stored.map((line) => {
    const other = incoming.find((l) => nameKey(l.name) === nameKey(line.name))
    return decide(`extraSpecs.${line.name}`, line, other ?? line, extraField(line), extraField(other), ctx)
  })
  const added = incoming
    .filter((l) => !stored.some((s) => nameKey(s.name) === nameKey(l.name)))
    .slice(0, Math.max(0, MAX_EXTRA_SPECS - stored.length))
  const addedOutcome: Outcome = { ...NOTHING, fills: added.map((l) => `extraSpecs.${l.name}`) }
  return { value: [...known.map((d) => d.value), ...added], outcome: [...known.map((d) => d.outcome), addedOutcome].reduce(combine, NOTHING) }
}

/** The row's conflicts after this write: settled fields leave, new readings join once per field and value. */
function nextConflicts(stored: readonly ProductConflict[], o: Outcome): ProductConflict[] {
  const settled = new Set([...o.fills, ...o.replaced])
  const kept = stored.filter((c) => !settled.has(c.field))
  const isKnown = (c: ProductConflict) => kept.some((k) => k.field === c.field && stable(k.found) === stable(c.found))
  return [...kept, ...o.found.filter((c) => !isKnown(c))]
}

function statusOf(o: Outcome): ChangeStatus {
  if (o.fills.length > 0 || o.replaced.length > 0) return 'updated'
  return o.conflicts.length > 0 ? 'conflicts' : 'unchanged'
}

export function mergeProduct(stored: ProductRecord | null, incoming: ProductInput, ctx: Ctx): MergeResult {
  const key = productKey(incoming)
  if (stored === null) {
    const change: ProductChange = { key, kind: incoming.kind, brand: incoming.brand, model: incoming.model, status: 'new', fills: [], replaced: [], conflicts: [] }
    return { change, next: incoming, conflicts: [] }
  }
  const url = (u: string | null): Field => ({ comparable: u, isStated: u !== null, source: u })
  const specs = mergeSpecs(stored.specs as Record<string, unknown>, incoming.specs as Record<string, unknown>, ctx)
  const makerUrl: Decided<string | null> = stored.makerUrl === null && incoming.makerUrl !== null
    ? { value: incoming.makerUrl, outcome: { ...NOTHING, fills: ['makerUrl'] } }
    : keep(stored.makerUrl)
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
  const change: ProductChange = {
    key, kind: stored.kind, brand: stored.brand, model: stored.model, status: statusOf(outcome),
    fills: outcome.fills, replaced: outcome.replaced, conflicts: outcome.conflicts,
  }
  return { change, next, conflicts: nextConflicts(stored.conflicts, outcome) }
}
