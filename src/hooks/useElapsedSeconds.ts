import { useEffect, useState } from 'react'

const TICK_MS = 1000

/**
 * Whole seconds since `isRunning` last turned true, updated once a second; 0 while it is false, and in the first render,
 * so the server's page and the browser's agree. It reads the clock on each tick rather than counting ticks, so a tab
 * the browser slowed down in the background shows the right time again as soon as it ticks.
 */
export function useElapsedSeconds(isRunning: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!isRunning) return
    const start = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / TICK_MS)), TICK_MS)
    return () => {
      clearInterval(timer)
      setSeconds(0)
    }
  }, [isRunning])
  return seconds
}
