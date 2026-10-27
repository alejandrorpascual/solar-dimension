import { createFileRoute } from '@tanstack/react-router'
import { retiredHandler } from '../../../server/catalog-api'
import { setProductRetired } from '../../../server/product-repo'

export const Route = createFileRoute('/api/catalog/products/$id/retire')({
  server: { handlers: { POST: retiredHandler(true, setProductRetired, 'product') } },
})
