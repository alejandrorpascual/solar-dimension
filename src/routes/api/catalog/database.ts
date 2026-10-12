import { createFileRoute } from '@tanstack/react-router'
import { databaseHandler } from '../../../server/catalog-api'

export const Route = createFileRoute('/api/catalog/database')({
  server: { handlers: { GET: databaseHandler } },
})
