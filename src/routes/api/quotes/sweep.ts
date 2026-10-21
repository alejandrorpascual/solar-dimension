import { createFileRoute } from '@tanstack/react-router'
import { sweepHandler } from '../../../server/quotes/sweep'

export const Route = createFileRoute('/api/quotes/sweep')({
  server: { handlers: { GET: sweepHandler } },
})
