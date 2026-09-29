/** A piece of the sheet that must not be cut between pages (a table row, the figures, a heading). */
export interface SheetBlock { top: number; bottom: number; keepWithNext?: boolean }

/** The part of the sheet image that goes on one page, in sheet pixels. */
export interface PageSlice { start: number; end: number }

/** A heading glued to the block after it, so it never ends a page alone. */
function mergeKeepWithNext(blocks: readonly SheetBlock[]): SheetBlock[] {
  const sorted = [...blocks].sort((a, b) => a.top - b.top)
  const { out, held } = sorted.reduce<{ out: SheetBlock[]; held: SheetBlock | null }>(({ out, held }, b) => {
    const joined = held ? { top: held.top, bottom: Math.max(held.bottom, b.bottom), keepWithNext: b.keepWithNext } : b
    return joined.keepWithNext ? { out, held: joined } : { out: [...out, joined], held: null }
  }, { out: [], held: null })
  return held ? [...out, held] : out
}

/**
 * Where each page starts and ends so no block is split: a page ends at the top of the first block that would cross
 * its bottom edge. A block taller than a page cannot fit anywhere, so it is cut at the edge instead.
 */
export function pageSlices(blocks: readonly SheetBlock[], totalHeight: number, pageHeight: number): PageSlice[] {
  const merged = mergeKeepWithNext(blocks)
  // Bottom padding can extend beyond A4 even when all content fits. It must never create a page of its own.
  const contentHeight = merged.length ? Math.min(totalHeight, Math.max(...merged.map((b) => b.bottom))) : totalHeight
  const slices: PageSlice[] = []
  let start = 0
  while (contentHeight - start > pageHeight) {
    const limit = start + pageHeight
    const crossing = merged.find((b) => b.top > start && b.top < limit && b.bottom > limit)
    const end = crossing ? crossing.top : limit
    slices.push({ start, end })
    start = end
  }
  return [...slices, { start, end: Math.min(totalHeight, start + pageHeight) }]
}
