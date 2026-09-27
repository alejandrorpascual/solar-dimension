import { createFileRoute } from '@tanstack/react-router'
import { retiredHandler } from '../../../server/catalog-api'

export const Route = createFileRoute('/api/catalog/appliances/$id/restore')({
  server: { handlers: { POST: retiredHandler(false) } },
})
