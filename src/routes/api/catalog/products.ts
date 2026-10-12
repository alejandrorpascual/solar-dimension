import { createFileRoute } from '@tanstack/react-router'
import { parseWriteFlags } from '../../../lib/api-flags'
import { parseProducts, productKey } from '../../../lib/product-schema'
import { API_ACTOR, authorize, json } from '../../../server/catalog-api'
import { listProducts, previewProducts, UnreadableProductsError, upsertProducts } from '../../../server/product-repo'

const unreadable = (error: UnreadableProductsError) =>
  json({ error: 'Stored products no longer pass the schema; fix or delete them before writing', keys: error.keys }, 409)

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
        // Before the body is read: a mistyped flag must never fall through to a real write.
        const flags = parseWriteFlags(new URL(request.url).searchParams, ['dryRun', 'replace'])
        if (!flags.ok) return json({ error: flags.error }, 400)
        const { dryRun, replace } = flags
        const parsed = parseProducts(await request.json().catch(() => undefined))
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        const keys = parsed.items.map(productKey)
        if (dryRun) {
          try {
            return json({ changes: await previewProducts(parsed.items, replace) })
          } catch (error) {
            if (error instanceof UnreadableProductsError) return unreadable(error)
            console.error('[catalog-api] product dry run failed', { keys, error })
            return json({ error: 'Could not read the products' }, 500)
          }
        }
        try {
          return json(await upsertProducts(parsed.items, { replace, actor: API_ACTOR }))
        } catch (error) {
          if (error instanceof UnreadableProductsError) return unreadable(error)
          console.error('[catalog-api] product upsert failed', { keys, error })
          return json({ error: 'Could not save; nothing was written' }, 500)
        }
      },
    },
  },
})
