import { MIN_POLL_MS, parsePollMs } from '../../lib/quote-jobs'

/** QUOTES_POLL_MS, read once when the server starts. An invalid value is logged once, without the value itself. */
const POLL = parsePollMs(process.env.QUOTES_POLL_MS)
if (POLL.isInvalid) {
  console.warn(`[quotes] QUOTES_POLL_MS is not a whole number of milliseconds from ${MIN_POLL_MS}; using the default`, { pollMs: POLL.pollMs })
}

/** How often the page asks about quotes being read, in milliseconds. */
export const quotePollMs = (): number => POLL.pollMs
