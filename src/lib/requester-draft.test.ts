import { expect, test } from 'vitest'
import { emptyRequester, type Requester } from './requester'
import { StoredDraftSchema, isDirty, isSameSlot, resumableDraft, type StoredDraft } from './requester-draft'

const blank = emptyRequester('VE')
const typed: Requester = { ...blank, name: 'Pedro Ram', doc: '1422' }
const stored: StoredDraft = { owner: 'user-a', projectId: 'p1', target: 'new', draft: typed, shouldRemember: false }

test('a draft is dirty only while it differs from where the form started', () => {
  expect(isDirty(blank, blank)).toBe(false)
  expect(isDirty(typed, blank)).toBe(true)
  expect(isDirty({ ...typed }, typed)).toBe(false)
})

test('an unfinished draft parses: no name yet, half an ID, untrimmed text', () => {
  const half = { ...stored, target: { client: 'c1' }, draft: { ...blank, name: '', doc: '40 12', email: 'pedro@' } }
  expect(StoredDraftSchema.safeParse(half).success).toBe(true)
})

test('a draft over the field caps or with an unknown target does not parse', () => {
  expect(StoredDraftSchema.safeParse({ ...stored, draft: { ...typed, name: 'x'.repeat(121) } }).success).toBe(false)
  expect(StoredDraftSchema.safeParse({ ...stored, target: 'everyone' }).success).toBe(false)
})

test('a draft comes back only to the same owner on the same project', () => {
  expect(resumableDraft(stored, 'user-a', 'p1')).toEqual(stored)
  expect(resumableDraft(stored, 'user-b', 'p1')).toBeNull()
  expect(resumableDraft(stored, null, 'p1')).toBeNull()
  expect(resumableDraft(stored, 'user-a', 'p2')).toBeNull()
  expect(resumableDraft(null, 'user-a', 'p1')).toBeNull()
})

test('a draft from before the save-to-clients choice was kept reads as ticked', () => {
  const { shouldRemember: _, ...older } = stored
  expect(StoredDraftSchema.parse(older).shouldRemember).toBe(true)
})

test('a draft slot belongs to one owner, project and target', () => {
  expect(isSameSlot(stored, { owner: 'user-a', projectId: 'p1', target: 'new' })).toBe(true)
  expect(isSameSlot(stored, { owner: 'user-a', projectId: 'p2', target: 'new' })).toBe(false)
  expect(isSameSlot(stored, { owner: null, projectId: 'p1', target: 'new' })).toBe(false)
  expect(isSameSlot(stored, { owner: 'user-a', projectId: 'p1', target: 'project' })).toBe(false)
  const client = { ...stored, target: { client: 'c1' } }
  expect(isSameSlot(client, { owner: 'user-a', projectId: 'p1', target: { client: 'c1' } })).toBe(true)
  expect(isSameSlot(client, { owner: 'user-a', projectId: 'p1', target: { client: 'c2' } })).toBe(false)
})
