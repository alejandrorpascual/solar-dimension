import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { quotes } from '../../../db/schema'
import { auth } from '../../../lib/auth'
import { quoteFileHeaders } from '../../../lib/quote-file-headers'
import { defaultStorage } from '../../../server/quotes/deps'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const notFound = () => new Response('Not found', { status: 404 })

/** The original file, to its owner only. Anyone else gets the same 404 as a quote that doesn't exist. */
export const Route = createFileRoute('/api/quotes/$id/file')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session || !UUID.test(params.id)) return notFound()
        const [row] = await db.select({ path: quotes.blobPathname, mime: quotes.mime, name: quotes.fileName }).from(quotes)
          .where(and(eq(quotes.id, params.id), eq(quotes.userId, session.user.id))).limit(1)
        if (!row) return notFound()
        try {
          const bytes = await defaultStorage.get(row.path)
          if (!bytes) return notFound()
          return new Response(Uint8Array.from(bytes), { headers: quoteFileHeaders(row.mime, row.name) })
        } catch (error) {
          console.error('[quotes] reading a quote file failed', { id: params.id, error })
          return new Response('Could not read the file', { status: 500 })
        }
      },
    },
  },
})
