import { useEffect, type RefObject } from 'react'

/**
 * Keeps `element`'s height in the root's custom property `name` while it is mounted, for stylesheets that leave room
 * for it. It follows the element's height as it changes: a footer whose summary wraps, a search row whose chips wrap.
 */
export function useHeightProperty(element: RefObject<HTMLElement | null>, name: string): void {
  useEffect(() => {
    const box = element.current
    if (!box) return
    const root = document.documentElement
    const publish = () => root.style.setProperty(name, `${box.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(box)
    return () => {
      observer.disconnect()
      root.style.removeProperty(name)
    }
  }, [element, name])
}
