/** A vertical extent on screen, as from getBoundingClientRect(). */
export interface Span { top: number; bottom: number }

/**
 * How far to scroll a box so a field inside it is in view with `margin` to spare: positive scrolls down, negative up,
 * 0 leaves it. A field taller than the box lines up its top, where typing starts.
 */
export function revealOffset(field: Span, box: Span, margin: number): number {
  const room = box.bottom - box.top - 2 * margin
  if (field.bottom - field.top > room) return field.top - box.top - margin
  if (field.bottom > box.bottom - margin) return field.bottom - box.bottom + margin
  if (field.top < box.top + margin) return field.top - box.top - margin
  return 0
}
