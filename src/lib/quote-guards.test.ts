import { PDFDocument } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import {
  canRetry, inspectUpload, MAX_RETRIES, MAX_TOTAL, MustInput, OverrideInput, parseTotal, QuoteId, RETRYABLE, refusedInsertRejection, retryOffer, retryRefusal, TotalInput,
  uploadRejection,
} from './quote-guards'
import { QUOTE_LIMITS } from './quote-limits'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
/** A day with reads left, and one whose budget is spent. */
const OPEN = { reads: 0, limit: 100 }
const SPENT = { reads: 100, limit: 100 }
const pdf = async (pages: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage()
  return new Uint8Array(await doc.save())
}

describe('uploadRejection', () => {
  test('a project the user does not own is not_saved, whatever the counts', () => {
    expect(uploadRejection({ ownsProject: false, counts: { project: 0, month: 0 }, daily: OPEN })).toEqual({ code: 'not_saved' })
    expect(uploadRejection({ ownsProject: false, counts: { project: 10, month: 20 }, daily: OPEN })).toEqual({ code: 'not_saved' })
  })
  test('refuses at 10 quotes in the project and at 20 this month, the project first', () => {
    const { perProject, perMonth } = QUOTE_LIMITS
    expect(uploadRejection({ ownsProject: true, counts: { project: perProject - 1, month: perMonth - 1 }, daily: OPEN })).toBeNull()
    expect(uploadRejection({ ownsProject: true, counts: { project: perProject, month: 0 }, daily: OPEN })).toEqual({ code: 'project_limit' })
    expect(uploadRejection({ ownsProject: true, counts: { project: 0, month: perMonth }, daily: OPEN })).toEqual({ code: 'month_limit' })
    expect(uploadRejection({ ownsProject: true, counts: { project: perProject, month: perMonth }, daily: OPEN })).toEqual({ code: 'project_limit' })
  })
})

describe('the daily read budget', () => {
  const { perProject } = QUOTE_LIMITS
  test('an upload is refused before any work once today’s reads reach the limit, after the account’s own limits', () => {
    expect(uploadRejection({ ownsProject: true, counts: { project: 0, month: 0 }, daily: { reads: 99, limit: 100 } })).toBeNull()
    expect(uploadRejection({ ownsProject: true, counts: { project: 0, month: 0 }, daily: SPENT })).toEqual({ code: 'daily_limit' })
    expect(uploadRejection({ ownsProject: true, counts: { project: perProject, month: 0 }, daily: SPENT })).toEqual({ code: 'project_limit' })
    expect(uploadRejection({ ownsProject: false, counts: { project: 0, month: 0 }, daily: SPENT })).toEqual({ code: 'not_saved' })
  })
  test('a refused insert names the spent budget when the account’s own limits still allow it', () => {
    expect(refusedInsertRejection({ project: 0, month: 0 }, SPENT)).toEqual({ code: 'daily_limit' })
    expect(refusedInsertRejection({ project: perProject, month: 0 }, SPENT)).toEqual({ code: 'project_limit' })
  })
})

describe('retryRefusal', () => {
  test('a retry that went through is not refused', () => {
    expect(retryRefusal({ retried: true, retryable: true, admitted: true })).toBeNull()
  })
  test('a retryable quote refused by the spent budget says so', () => {
    expect(retryRefusal({ retried: false, retryable: true, admitted: false })).toEqual({ code: 'daily_limit' })
  })
  test('a quote that is not the user’s, not failed, or out of retries is not found, whatever the budget', () => {
    expect(retryRefusal({ retried: false, retryable: false, admitted: false })).toBe('not_found')
    expect(retryRefusal({ retried: false, retryable: true, admitted: true })).toBe('not_found')
  })
})

describe('refusedInsertRejection', () => {
  const { perProject, perMonth } = QUOTE_LIMITS
  test('names the limit the counts show, the project first', () => {
    expect(refusedInsertRejection({ project: perProject, month: 0 }, OPEN)).toEqual({ code: 'project_limit' })
    expect(refusedInsertRejection({ project: 0, month: perMonth }, OPEN)).toEqual({ code: 'month_limit' })
    expect(refusedInsertRejection({ project: perProject, month: perMonth }, OPEN)).toEqual({ code: 'project_limit' })
  })
  test('is a plain upload failure when the counts no longer show a limit', () => {
    expect(refusedInsertRejection({ project: 0, month: 0 }, OPEN)).toEqual({ code: 'upload' })
  })
})

describe('inspectUpload', () => {
  test('a real PDF within the page limit is accepted with its page count', async () => {
    expect(await inspectUpload(await pdf(3))).toEqual({ ok: true, mime: 'application/pdf', pages: 3 })
  })
  test('a PDF over the page limit is refused with its page count', async () => {
    const pages = QUOTE_LIMITS.maxPages + 1
    expect(await inspectUpload(await pdf(pages))).toEqual({ ok: false, rejection: { code: 'pages', pages } })
  })
  test('a photo is accepted without a page count', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    expect(await inspectUpload(png)).toEqual({ ok: true, mime: 'image/png', pages: null })
  })
  test('bytes of another type, or a broken PDF, are refused as the wrong type', async () => {
    const text = (s: string) => new TextEncoder().encode(s)
    expect(await inspectUpload(text('<html></html>'))).toEqual({ ok: false, rejection: { code: 'type' } })
    expect(await inspectUpload(text('%PDF-1.4 this is not a real pdf'))).toEqual({ ok: false, rejection: { code: 'type' } })
  })
})

describe('inputs', () => {
  test('a quote id must be a UUID', () => {
    expect(QuoteId.safeParse(ID).success).toBe(true)
    expect(QuoteId.safeParse('not-a-uuid').success).toBe(false)
  })
  test('an override needs a known item and a known value, or null to remove it', () => {
    expect(OverrideInput.safeParse({ quoteId: ID, item: 'charger', value: 'included' }).success).toBe(true)
    expect(OverrideInput.safeParse({ quoteId: ID, item: 'charger', value: null }).success).toBe(true)
    expect(OverrideInput.safeParse({ quoteId: ID, item: 'toaster', value: 'included' }).success).toBe(false)
    expect(OverrideInput.safeParse({ quoteId: ID, item: 'charger', value: 'maybe' }).success).toBe(false)
  })
  test('a corrected total is a positive, finite amount up to the cap', () => {
    const total = (n: number) => TotalInput.safeParse({ quoteId: ID, total: n }).success
    expect(total(6480.5)).toBe(true)
    expect(total(MAX_TOTAL)).toBe(true)
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, MAX_TOTAL + 1]) expect(total(bad)).toBe(false)
  })
  test('a must-have change is one known item set to a boolean, for a real project id', () => {
    expect(MustInput.safeParse({ projectId: 'p1', item: 'fuse', value: false }).success).toBe(true)
    expect(MustInput.safeParse({ projectId: 'p1', item: 'solar_panel', value: true }).success).toBe(false)
    expect(MustInput.safeParse({ projectId: 'p1', item: 'fuse', value: 'yes' }).success).toBe(false)
    expect(MustInput.safeParse({ projectId: 'p1', item: 'fuse' }).success).toBe(false)
    expect(MustInput.safeParse({ projectId: '', item: 'fuse', value: true }).success).toBe(false)
  })
  test('only a failed quote, or one to check, can be retried', () => {
    expect(RETRYABLE).toEqual(['failed', 'needs_review'])
  })
})

describe('canRetry', () => {
  test('a failed quote can be retried until it has used its retries', () => {
    expect(MAX_RETRIES).toBe(3)
    expect(canRetry({ status: 'failed', retries: 0 })).toBe(true)
    expect(canRetry({ status: 'failed', retries: MAX_RETRIES - 1 })).toBe(true)
    expect(canRetry({ status: 'failed', retries: MAX_RETRIES })).toBe(false)
  })
  test('a quote being read, or read and ready, cannot be retried', () => {
    for (const status of ['queued', 'processing', 'ready'] as const) expect(canRetry({ status, retries: 0 })).toBe(false)
  })
})

describe('retryOffer', () => {
  test('a quote whose numbers need checking can be read again, until it has used its retries', () => {
    expect(canRetry({ status: 'needs_review', retries: 0 })).toBe(true)
    expect(retryOffer({ status: 'needs_review', retries: 0 }, true)).toBe('retry')
    expect(retryOffer({ status: 'needs_review', retries: MAX_RETRIES }, true)).toBe('used_up')
    expect(retryOffer({ status: 'needs_review', retries: 0 }, false)).toBe('none')
  })
  const failed = { status: 'failed' as const, retries: 0 }
  test('a failed quote with retries left offers Retry to an account that may start reads', () => {
    expect(retryOffer(failed, true)).toBe('retry')
  })
  test('a quote that used its retries says so', () => {
    expect(retryOffer({ status: 'failed', retries: MAX_RETRIES }, true)).toBe('used_up')
  })
  test('an account that may not start reads is offered nothing, whatever the retries', () => {
    expect(retryOffer(failed, false)).toBe('none')
    expect(retryOffer({ status: 'failed', retries: MAX_RETRIES }, false)).toBe('none')
  })
})

describe('parseTotal', () => {
  test('a typed total in either convention becomes a number', () => {
    expect(parseTotal('6.480,50')).toBe(6480.5)
    expect(parseTotal('$6,480')).toBe(6480)
    expect(parseTotal(String(MAX_TOTAL))).toBe(MAX_TOTAL)
  })
  test('empty, zero, negative, non-numeric or above the cap is refused', () => {
    for (const bad of ['', '   ', 'abc', '0', '0,00', '-5', String(MAX_TOTAL + 1)]) expect(parseTotal(bad)).toBeNull()
  })
})
