import { bearerToken, isApiEnabled, MIN_TOKEN_LENGTH, tokenMatches } from '../../lib/api-token'
import { defaultDeps, emptyQuoteTrash } from './deps'
import { JOB_WORST_CASE_MS, processQuote } from './process'
import { recoverStaleQuotes } from './repo'
import { FUNCTION_MAX_DURATION_MS } from './time-limits'

const SWEEP_LIMIT = 20

/** Whether a read started `elapsedMs` into the call could still end before the platform cuts the function off. */
const hasTimeForJob = (elapsedMs: number): boolean => elapsedMs + JOB_WORST_CASE_MS <= FUNCTION_MAX_DURATION_MS

/**
 * Safety net for jobs no poll re-kicked (the user left for good). It also gives up on stuck jobs with no attempts left,
 * and removes the files of deleted quotes that storage refused at delete time. Vercel Cron calls it with CRON_SECRET.
 */
export async function sweepHandler({ request }: { request: Request }): Promise<Response> {
  const startedAt = Date.now()
  const secret = process.env.CRON_SECRET
  // tokenMatches refuses a short secret whatever the caller sends, so without this line the daily sweep stops unseen.
  if (secret && !isApiEnabled(secret)) {
    console.error(`[quotes] CRON_SECRET is shorter than ${MIN_TOKEN_LENGTH} characters, so the sweep refuses every call`)
  }
  if (!secret || !tokenMatches(bearerToken(request.headers.get('authorization')), secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // First, and quick: the jobs below can take minutes each. It never throws; failures are logged and kept.
  const trash = await emptyQuoteTrash()
  const ids = await recoverStaleQuotes(undefined, SWEEP_LIMIT)
  const outcomes = []
  // One at a time, each only while it could still end inside the limit: a read cut off mid-way would hold its claim
  // until the claim goes stale. A job not started stays as it is, for a poll or the next sweep.
  for (const id of ids) {
    if (!hasTimeForJob(Date.now() - startedAt)) break
    outcomes.push(await processQuote(id, defaultDeps()).catch((error) => {
      console.error('[quotes] sweep failed on a job', { id, error })
      return 'error' as const
    }))
  }
  return Response.json({
    processed: outcomes.length, left: ids.length - outcomes.length, outcomes,
    trash: { removed: trash.removed.length, kept: trash.kept.length },
  })
}
