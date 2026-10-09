import { createFileRoute } from '@tanstack/react-router'
import { parseProducts, productKey } from '../../../lib/product-schema'
import { API_ACTOR, authorize, json } from '../../../server/catalog-api'
import { listProducts, previewProducts, upsertProducts } from '../../../server/product-repo'

/** The product library, for the /research-product skill. Same token, throttle and envelope as the appliance API. */
export const Route = createFileRoute('/api/catalog/products')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        try {
          return json({ items: await listProducts() })
        } catch (error) {
          console.error('[catalog-api] reading the products failed', { error })
          return json({ error: 'Could not read the products' }, 500)
        }
      },
      POST: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        const parsed = parseProducts(await request.json().catch(() => undefined))
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        const params = new URL(request.url).searchParams
        const replace = params.get('replace') === 'true'
        const keys = parsed.items.map(productKey)
        if (params.get('dryRun') === 'true') {
          try {
            return json({ changes: await previewProducts(parsed.items, replace) })
          } catch (error) {
            console.error('[catalog-api] product dry run failed', { keys, error })
            return json({ error: 'Could not read the products' }, 500)
          }
        }
        try {
          return json(await upsertProducts(parsed.items, { replace, actor: API_ACTOR }))
        } catch (error) {
          console.error('[catalog-api] product upsert failed', { keys, error })
          return json({ error: 'Could not save; nothing was written' }, 500)
        }
      },
    },
  },
})
