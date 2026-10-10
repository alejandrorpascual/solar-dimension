import { z } from 'zod'
import { REQUESTER_COUNTRIES, REQUESTER_KINDS, REQUESTER_MAX, type Requester } from './requester'

/** The form as typed: the requester's fields and caps, but no required name and no ID or email checks yet. */
const RequesterDraftSchema = z.object({
  kind: z.enum(REQUESTER_KINDS),
  country: z.enum(REQUESTER_COUNTRIES),
  name: z.string().max(REQUESTER_MAX.name),
  contact: z.string().max(REQUESTER_MAX.contact),
  docPrefix: z.string().max(1),
  doc: z.string().max(REQUESTER_MAX.doc),
  phone: z.string().max(REQUESTER_MAX.phone),
  email: z.string().max(REQUESTER_MAX.email),
  address: z.string().max(REQUESTER_MAX.address),
})

/** What the form was editing: a new client, the project's own requester, or a saved client by id. */
const DraftTargetSchema = z.union([z.literal('new'), z.literal('project'), z.object({ client: z.string().min(1) })])
export type DraftTarget = z.infer<typeof DraftTargetSchema>

/** The one unsaved form kept in this browser, so closing the dialog by accident loses nothing. */
export const StoredDraftSchema = z.object({
  owner: z.string().nullable(),
  projectId: z.string().min(1),
  target: DraftTargetSchema,
  draft: RequesterDraftSchema,
  /** "Save to my clients", as it was left; drafts kept before it was stored read as ticked, the form's default. */
  shouldRemember: z.boolean().default(true),
})
export type StoredDraft = z.infer<typeof StoredDraftSchema>

/** Which form a draft belongs to. Another tab may be writing the same slot, so a form only ever clears its own. */
export type DraftSlot = Pick<StoredDraft, 'owner' | 'projectId' | 'target'>

const targetKey = (target: DraftTarget): string => (typeof target === 'object' ? `client:${target.client}` : target)

export function isSameSlot(stored: DraftSlot, slot: DraftSlot): boolean {
  return stored.owner === slot.owner && stored.projectId === slot.projectId && targetKey(stored.target) === targetKey(slot.target)
}

const FIELDS = Object.keys(RequesterDraftSchema.shape) as Array<keyof Requester>

export function isDirty(draft: Requester, base: Requester): boolean {
  return FIELDS.some((field) => draft[field] !== base[field])
}

/** The kept draft when it belongs to this owner and this project; another account or project never sees it. */
export function resumableDraft(stored: StoredDraft | null, owner: string | null, projectId: string): StoredDraft | null {
  return stored && stored.owner === owner && stored.projectId === projectId ? stored : null
}
