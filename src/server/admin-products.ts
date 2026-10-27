import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PublicError } from '../lib/server-error'
import { requireAdmin } from './admin-catalog'
import { listProductsForAdmin, verifyProduct, type AdminProduct } from './product-repo'

export const adminListProducts = createServerFn({ method: 'GET' }).handler(async (): Promise<AdminProduct[]> => {
  await requireAdmin()
  return listProductsForAdmin()
})

/** Who verifies is the signed-in admin, never a field of the request. */
const VerifyInput = z.object({ id: z.uuid(), seenUpdatedAt: z.iso.datetime() }).strict()

export const adminVerifyProduct = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    const admin = await requireAdmin()
    const { id, seenUpdatedAt } = VerifyInput.parse(data)
    if (!(await verifyProduct(id, seenUpdatedAt, admin.id))) {
      throw new PublicError('This product changed since this page loaded, or is gone. Reload the page and check it again.')
    }
    return { ok: true as const }
  })
