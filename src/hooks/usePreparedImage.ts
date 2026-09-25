import { useEffect, useState, type RefObject } from 'react'
import { renderPng } from '../client/export-file'

/** Wait for edits to settle before capturing again. */
const PREPARE_DELAY_MS = 500

/**
 * The sheet as a PNG, made ahead of time. Browsers only allow `navigator.share` within a moment of the tap, too
 * short to load the capture library and draw the sheet, so the Share button needs the image ready before it is
 * pressed. `key` names the content; the image is redone whenever it changes, and null until then.
 */
export function usePreparedImage(ref: RefObject<HTMLElement | null>, enabled: boolean, key: string): Blob | null {
  const [ready, setReady] = useState<{ key: string; blob: Blob } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let isCancelled = false
    const timer = setTimeout(() => {
      const node = ref.current
      // A panel that is mounted but not displayed (the rail on a phone) has nothing to capture.
      if (!node || node.offsetWidth === 0) return
      renderPng(node)
        .then((blob) => { if (!isCancelled) setReady({ key, blob }) })
        .catch((err: unknown) => { if (!isCancelled) console.error('Could not prepare the share image', { key, err }) })
    }, PREPARE_DELAY_MS)
    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [enabled, key, ref])

  return ready?.key === key ? ready.blob : null
}
