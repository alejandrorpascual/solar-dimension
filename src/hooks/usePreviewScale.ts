import { useEffect, useRef, useState } from 'react'

/**
 * Fits a fixed-width element into its container: `scale` shrinks it to the container's width and `height` is the
 * scaled height (capped), so the box around it takes the right amount of room. Both follow resizes.
 */
export function usePreviewScale(contentWidth: number, maxHeight: number) {
  const boxRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 0.4, height: maxHeight })

  useEffect(() => {
    const box = boxRef.current
    const content = contentRef.current
    if (!box || !content || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const scale = box.clientWidth / contentWidth
      setFit({ scale, height: Math.min(maxHeight, Math.ceil(content.offsetHeight * scale)) })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    observer.observe(content)
    measure()
    return () => observer.disconnect()
  }, [contentWidth, maxHeight])

  return { boxRef, contentRef, ...fit }
}
