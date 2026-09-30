export interface SingleFlight {
  /** True if the caller may start; false if a run is already in progress. */
  tryEnter: () => boolean
  release: () => void
  isBusy: () => boolean
}

/** A re-entry guard that reads synchronously, so two calls in the same tick can't both start. */
export function createSingleFlight(): SingleFlight {
  let busy = false
  return {
    tryEnter: () => {
      if (busy) return false
      busy = true
      return true
    },
    release: () => { busy = false },
    isBusy: () => busy,
  }
}
