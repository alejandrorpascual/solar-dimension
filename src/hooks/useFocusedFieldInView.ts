import { useEffect, type RefObject } from 'react'
import { revealOffset } from '../lib/scroll-reveal'

const FIELD_MARGIN = 16

/**
 * Keeps the focused field inside `container` in view within the element that scrolls it (`scrollerSelector`, an
 * ancestor). On a phone the keyboard shrinks a dialog only after the field already has focus, so the browser's own
 * scroll-into-view, which runs at focus, comes too early: this runs again whenever the scroller changes size.
 */
export function useFocusedFieldInView(container: RefObject<HTMLElement | null>, scrollerSelector: string): void {
  useEffect(() => {
    const root = container.current
    const scroller = root?.closest<HTMLElement>(scrollerSelector)
    if (!root || !scroller || typeof ResizeObserver === 'undefined') return
    const reveal = () => {
      const field = document.activeElement
      if (!(field instanceof HTMLElement) || !root.contains(field)) return
      const offset = revealOffset(field.getBoundingClientRect(), scroller.getBoundingClientRect(), FIELD_MARGIN)
      if (offset !== 0) scroller.scrollTop += offset
    }
    // A frame later, so the scroller's new size (and the browser's own scroll) has settled.
    let frame = 0
    const revealSoon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(reveal)
    }
    const observer = new ResizeObserver(revealSoon)
    observer.observe(scroller)
    root.addEventListener('focusin', revealSoon)
    return () => {
      observer.disconnect()
      root.removeEventListener('focusin', revealSoon)
      cancelAnimationFrame(frame)
    }
  }, [container, scrollerSelector])
}
