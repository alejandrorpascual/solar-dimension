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
    const node = ref.current
    if (!enabled || !node) return
    let isCancelled = false
    let isDone = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const capture = () => {
      renderPng(node)
        .then((blob) => {
          if (isCancelled) return
          isDone = true
          setReady({ key, blob })
        })
        .catch((err: unknown) => { if (!isCancelled) console.error('Could not prepare the share image', { key, err }) })
    }
    // A panel that is mounted but not displayed (the rail below 1280 px) has nothing to capture yet; it is tried
    // again whenever its size changes, so rotating a tablet into the wide layout still prepares the image.
    const schedule = () => {
      clearTimeout(timer)
      if (!isDone && node.offsetWidth > 0) timer = setTimeout(capture, PREPARE_DELAY_MS)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(node)
    schedule()
    return () => {
      isCancelled = true
      clearTimeout(timer)
      observer?.disconnect()
    }
  }, [enabled, key, ref])

  return ready?.key === key ? ready.blob : null
}
