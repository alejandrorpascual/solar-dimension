export interface Latest {
  /** Starts a request. The returned check stays true until a newer request starts or `invalidate` runs. */
  begin: () => () => boolean
  /** Makes every request in flight stale, e.g. on sign-out or before an optimistic change. */
  invalidate: () => void
}

/** Lets only the newest of several overlapping requests apply its answer. */
export function createLatest(): Latest {
  let seq = 0
  return {
    begin: () => {
      const mine = ++seq
      return () => mine === seq
    },
    invalidate: () => { seq++ },
  }
}
