import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { isAdmin } from '../lib/admin'
import { auth } from '../lib/auth'
import { ApplianceSchema, type ApplianceRecord } from '../lib/catalog-schema'
import { PublicError } from '../lib/server-error'
import { applianceExists, listRecords, recentChanges, revertChange, setRetired, upsertAppliances, type ApplianceChangeEntry } from './catalog-repo'

async function adminUser() {
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  return session && isAdmin(session.user, process.env.ADMIN_EMAILS) ? session.user : null
}

/** Throws a plain "Not found" so a non-admin cannot tell the admin tools exist. */
export const requireAdmin = createServerOnlyFn(async () => {
  const user = await adminUser()
  if (!user) throw new PublicError('Not found')
  return user
})

export const checkAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean> => (await adminUser()) !== null)

export const adminListAppliances = createServerFn({ method: 'GET' }).handler(async (): Promise<ApplianceRecord[]> => {
  await requireAdmin()
  return listRecords()
})

export const adminRecentChanges = createServerFn({ method: 'GET' }).handler(async (): Promise<ApplianceChangeEntry[]> => {
  await requireAdmin()
  return recentChanges()
})

const SaveApplianceInput = z.object({ mode: z.enum(['create', 'update']), item: ApplianceSchema }).strict()

export const adminSaveAppliance = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    const { mode, item } = SaveApplianceInput.parse(data)
    if (mode === 'create') {
      if (await applianceExists(item.id)) {
        throw new PublicError(`The id "${item.id}" is already used by another appliance. Change the English name.`)
      }
    } else if (!(await applianceExists(item.id))) {
      throw new PublicError('Not found')
    }
    return upsertAppliances([item], user.id)
  })

const SetRetiredInput = z.object({ id: z.string().min(1), retired: z.boolean() })

export const adminSetRetired = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    const { id, retired } = SetRetiredInput.parse(data)
    if (!(await setRetired(id, retired, user.id))) throw new PublicError('Not found')
    return { ok: true as const }
  })

const RevertChangeInput = z.object({ changeId: z.number().int().positive() }).strict()

/** Why a revert wrote nothing, in the admin's words. */
const REVERT_REFUSED = {
  'not-found': 'Not found',
  created: 'This change created the appliance, so there is nothing before it to put back. Retire it instead.',
  invalid: 'The values before this change fail the catalog checks, so they cannot be put back.',
  unchanged: 'The appliance already has the values from before this change.',
} as const

export const adminRevertChange = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    const { changeId } = RevertChangeInput.parse(data)
    const outcome = await revertChange(changeId, user.id)
    if (outcome !== 'reverted') throw new PublicError(REVERT_REFUSED[outcome])
    return { ok: true as const }
  })
