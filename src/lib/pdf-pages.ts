/**
 * A piece of the sheet that must not be cut between pages (a table row, the figures, a heading). `breakBefore` asks
 * for a new page before it even when the current one has room (the load schedule, which is kept off page one);
 * `pageSlices` says when that break is not taken.
 */
export interface SheetBlock { top: number; bottom: number; keepWithNext?: boolean; breakBefore?: boolean }

/** The part of the sheet image that goes on one page, in sheet pixels. */
export interface PageSlice { start: number; end: number }

/** A heading glued to the block after it, so it never ends a page alone. The group keeps the heading's page break. */
function mergeKeepWithNext(blocks: readonly SheetBlock[]): SheetBlock[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top)
  const { out, held } = sorted.reduce<{ out: SheetBlock[]; held: SheetBlock | null }>(({ out, held }, b) => {
    const joined = held
      ? { top: held.top, bottom: Math.max(held.bottom, b.bottom), keepWithNext: b.keepWithNext, breakBefore: held.breakBefore }
      : b
    return joined.keepWithNext ? { out, held: joined } : { out: [...out, joined], held: null }
  }, { out: [], held: null })
  return held ? [...out, held] : out
}

/**
 * Where each page starts and ends so no block is split: a page ends at the next forced break, or else at the top of
 * the first block that would cross its bottom edge. A block taller than a page cannot fit anywhere, so it is cut at
 * the edge instead. Pages after the first are drawn `continuationTop` down (the first has the sheet's own padding),
 * so they hold that much less.
 *
 * A forced break is not taken on a page that began because the one before overflowed: all that page holds above the
 * block is what ran over, and breaking again would give that remainder a page to itself, however short it is.
 */
export function pageSlices(blocks: readonly SheetBlock[], totalHeight: number, pageHeight: number, continuationTop = 0): PageSlice[] {
  const merged = mergeKeepWithNext(blocks)
  // Bottom padding can extend beyond A4 even when all content fits. It must never create a page of its own.
  const contentHeight = merged.length ? Math.min(totalHeight, Math.max(...merged.map((b) => b.bottom))) : totalHeight
  const slices: PageSlice[] = []
  let start = 0
  let isOverflowPage = false
  for (;;) {
    const room = slices.length === 0 ? pageHeight : pageHeight - continuationTop
    // A page with no room after its margin could never move forward; end the sheet there rather than loop.
    if (room <= 0) return [...slices, { start, end: totalHeight }]
    const limit = start + room
    const forced: SheetBlock | undefined = isOverflowPage ? undefined : merged.find((b) => b.breakBefore && b.top > start && b.top <= limit)
    if (!forced && contentHeight - start <= room) return [...slices, { start, end: Math.min(totalHeight, limit) }]
    const crossing = merged.find((b) => b.top > start && b.top < limit && b.bottom > limit)
    const end = forced ? forced.top : crossing ? crossing.top : limit
    slices.push({ start, end })
    isOverflowPage = !forced
    start = end
  }
}
