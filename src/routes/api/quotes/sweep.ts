import { createFileRoute } from '@tanstack/react-router'
import { bearerToken, tokenMatches } from '../../../lib/api-token'
import { defaultDeps } from '../../../server/quotes/deps'
import { processQuote } from '../../../server/quotes/process'
import { recoverStaleQuotes } from '../../../server/quotes/repo'

const SWEEP_LIMIT = 20

/**
 * Safety net for jobs no poll re-kicked (the user left for good). It also gives up on stuck jobs with no attempts left.
 * Vercel Cron calls it with CRON_SECRET.
 */
export const Route = createFileRoute('/api/quotes/sweep')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET
        if (!secret || !tokenMatches(bearerToken(request.headers.get('authorization')), secret)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const ids = await recoverStaleQuotes(undefined, SWEEP_LIMIT)
        const outcomes = []
        for (const id of ids) outcomes.push(await processQuote(id, defaultDeps()).catch((error) => {
          console.error('[quotes] sweep failed on a job', { id, error })
          return 'error' as const
        }))
        return Response.json({ processed: ids.length, outcomes })
      },
    },
  },
})
