import { createFileRoute } from '@tanstack/react-router'
import { diffAppliances } from '../../../lib/catalog-diff'
import { parseItems } from '../../../lib/catalog-schema'
import { API_ACTOR, authorize, json } from '../../../server/catalog-api'
import { listRecords, upsertAppliances } from '../../../server/catalog-repo'

export const Route = createFileRoute('/api/catalog/appliances')({
  server: {
    handlers: {
      GET: async ({ request }) => authorize(request) ?? json({ items: await listRecords() }),
      POST: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        const body = await request.json().catch(() => undefined)
        const parsed = parseItems(body)
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        if (new URL(request.url).searchParams.get('dryRun') === 'true') {
          return json({ changes: diffAppliances(await listRecords(), parsed.items) })
        }
        try {
          return json(await upsertAppliances(parsed.items, API_ACTOR))
        } catch (error) {
          console.error('[catalog-api] upsert failed', { ids: parsed.items.map((i) => i.id), error })
          return json({ error: 'Could not save; nothing was written' }, 500)
        }
      },
    },
  },
})
