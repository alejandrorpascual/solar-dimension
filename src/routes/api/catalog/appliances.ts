import { createFileRoute } from '@tanstack/react-router'
import { diffAppliances } from '../../../lib/catalog-diff'
import type { ApplianceRecord } from '../../../lib/catalog-schema'
import { parseItems } from '../../../lib/catalog-schema'
import { API_ACTOR, authorize, json } from '../../../server/catalog-api'
import { listRecords, upsertAppliances } from '../../../server/catalog-repo'

/** listRecords() behind a try/catch, so a DB outage returns the API's JSON envelope, not the framework's HTML error page. */
async function readCatalog(logContext: Record<string, unknown> = {}): Promise<ApplianceRecord[] | Response> {
  try {
    return await listRecords()
  } catch (error) {
    console.error('[catalog-api] reading the catalog failed', { ...logContext, error })
    return json({ error: 'Could not read the catalog' }, 500)
  }
}

export const Route = createFileRoute('/api/catalog/appliances')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        const records = await readCatalog()
        return records instanceof Response ? records : json({ items: records })
      },
      POST: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        const body = await request.json().catch(() => undefined)
        const parsed = parseItems(body)
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        const ids = parsed.items.map((i) => i.id)
        if (new URL(request.url).searchParams.get('dryRun') === 'true') {
          const records = await readCatalog({ ids })
          return records instanceof Response ? records : json({ changes: diffAppliances(records, parsed.items) })
        }
        try {
          return json(await upsertAppliances(parsed.items, API_ACTOR))
        } catch (error) {
          console.error('[catalog-api] upsert failed', { ids, error })
          return json({ error: 'Could not save; nothing was written' }, 500)
        }
      },
    },
  },
})
