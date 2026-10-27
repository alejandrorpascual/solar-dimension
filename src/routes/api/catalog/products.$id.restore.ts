import { createFileRoute } from '@tanstack/react-router'
import { retiredHandler } from '../../../server/catalog-api'
import { setProductRetired } from '../../../server/product-repo'

export const Route = createFileRoute('/api/catalog/products/$id/restore')({
  server: { handlers: { POST: retiredHandler(false, setProductRetired, 'product') } },
})
