import { createFileRoute } from '@tanstack/react-router'
import { parseWriteFlags } from '../../../lib/api-flags'
import { parseProducts, productKey } from '../../../lib/product-schema'
import { API_ACTOR, authorize, json } from '../../../server/catalog-api'
import { listProducts, previewProducts, UnreadableProductsError, upsertProducts } from '../../../server/product-repo'

const unreadable = (error: UnreadableProductsError) =>
  json({ error: 'Stored products no longer pass the schema; fix or delete them before writing', keys: error.keys }, 409)

/**
 * The product library, for the /research-product skill. Same token, throttle and envelope as the appliance API. GET
 * leaves retired products out unless includeRetired=true.
 */
export const Route = createFileRoute('/api/catalog/products')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        const query = parseWriteFlags(new URL(request.url).searchParams, ['includeRetired'])
        if (!query.ok) return json({ error: query.error }, 400)
        try {
          return json({ items: await listProducts(query.flags) })
        } catch (error) {
          console.error('[catalog-api] reading the products failed', { error })
          return json({ error: 'Could not read the products' }, 500)
        }
      },
      POST: async ({ request }) => {
        const denied = authorize(request)
        if (denied) return denied
        // Before the body is read: a mistyped flag must never fall through to a real write.
        const query = parseWriteFlags(new URL(request.url).searchParams, ['dryRun', 'replace'])
        if (!query.ok) return json({ error: query.error }, 400)
        const { dryRun, replace } = query.flags
        const parsed = parseProducts(await request.json().catch(() => undefined))
        if (!parsed.ok) return json({ errors: parsed.errors }, 422)
        // A clear without replace would be dropped by the merge; refused so the caller never thinks a value went.
        const clearing = parsed.items.flatMap((item, index) => (item.clear && !replace ? [index] : []))
        if (clearing.length > 0) return json({ errors: clearing.map((index) => ({ index, issues: [{ path: 'clear', message: 'clear needs replace=true' }] })) }, 422)
        const keys = parsed.items.map(productKey)
        if (dryRun) {
          try {
            return json(await previewProducts(parsed.items, replace))
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
