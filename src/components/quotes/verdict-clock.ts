import { createClock } from '../../lib/quote-pending'

/**
 * Orders the verdict page's reloads against its saves (browser only): the route's loader ticks when it requests the
 * data, and each save ticks when it answers. See prunePending.
 */
export const verdictClock = createClock()
