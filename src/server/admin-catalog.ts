import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { isAdmin } from '../lib/admin'
import { auth } from '../lib/auth'
import { ApplianceSchema, type ApplianceRecord } from '../lib/catalog-schema'
import { listRecords, setRetired, upsertAppliances } from './catalog-repo'

async function adminUser() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return session && isAdmin(session.user, process.env.ADMIN_EMAILS) ? session.user : null
}

/** Throws a plain "Not found" so a non-admin cannot tell the admin tools exist. */
const requireAdmin = createServerOnlyFn(async () => {
  const user = await adminUser()
  if (!user) throw new Error('Not found')
  return user
})

export const checkAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean> => (await adminUser()) !== null)

export const adminListAppliances = createServerFn({ method: 'GET' }).handler(async (): Promise<ApplianceRecord[]> => {
  await requireAdmin()
  return listRecords()
})

export const adminSaveAppliance = createServerFn({ method: 'POST' })
  .validator((d: unknown) => ApplianceSchema.parse(d))
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    return upsertAppliances([data], user.id)
  })

export const adminSetRetired = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ id: z.string().min(1), retired: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    if (!(await setRetired(data.id, data.retired, user.id))) throw new Error('Not found')
    return { ok: true as const }
  })
