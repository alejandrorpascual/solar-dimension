import { PDFDocument } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import {
  canRetry, inspectUpload, MAX_RETRIES, MAX_TOTAL, MustsInput, OverrideInput, parseTotal, QuoteId, RETRYABLE, refusedInsertRejection, TotalInput, uploadRejection,
} from './quote-guards'
import { DEFAULT_MUSTS } from './quote-items'
import { QUOTE_LIMITS } from './quote-limits'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const pdf = async (pages: number): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage()
  return new Uint8Array(await doc.save())
}

describe('uploadRejection', () => {
  test('a project the user does not own is not_saved, whatever the counts', () => {
    expect(uploadRejection({ ownsProject: false, counts: { project: 0, month: 0 } })).toEqual({ code: 'not_saved' })
    expect(uploadRejection({ ownsProject: false, counts: { project: 10, month: 20 } })).toEqual({ code: 'not_saved' })
  })
  test('refuses at 10 quotes in the project and at 20 this month, the project first', () => {
    const { perProject, perMonth } = QUOTE_LIMITS
    expect(uploadRejection({ ownsProject: true, counts: { project: perProject - 1, month: perMonth - 1 } })).toBeNull()
    expect(uploadRejection({ ownsProject: true, counts: { project: perProject, month: 0 } })).toEqual({ code: 'project_limit' })
    expect(uploadRejection({ ownsProject: true, counts: { project: 0, month: perMonth } })).toEqual({ code: 'month_limit' })
    expect(uploadRejection({ ownsProject: true, counts: { project: perProject, month: perMonth } })).toEqual({ code: 'project_limit' })
  })
})

describe('refusedInsertRejection', () => {
  const { perProject, perMonth } = QUOTE_LIMITS
  test('names the limit the counts show, the project first', () => {
    expect(refusedInsertRejection({ project: perProject, month: 0 })).toEqual({ code: 'project_limit' })
    expect(refusedInsertRejection({ project: 0, month: perMonth })).toEqual({ code: 'month_limit' })
    expect(refusedInsertRejection({ project: perProject, month: perMonth })).toEqual({ code: 'project_limit' })
  })
  test('is a plain upload failure when the counts no longer show a limit', () => {
    expect(refusedInsertRejection({ project: 0, month: 0 })).toEqual({ code: 'upload' })
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
  test('must-haves need every item as a boolean, for a real project id', () => {
    expect(MustsInput.safeParse({ projectId: 'p1', musts: DEFAULT_MUSTS }).success).toBe(true)
    const { fuse: _fuse, ...withoutFuse } = DEFAULT_MUSTS
    expect(MustsInput.safeParse({ projectId: 'p1', musts: withoutFuse }).success).toBe(false)
    expect(MustsInput.safeParse({ projectId: 'p1', musts: { ...DEFAULT_MUSTS, fuse: 'yes' } }).success).toBe(false)
    expect(MustsInput.safeParse({ projectId: '', musts: DEFAULT_MUSTS }).success).toBe(false)
  })
  test('only a failed quote can be retried', () => {
    expect(RETRYABLE).toEqual(['failed'])
  })
})

describe('canRetry', () => {
  test('a failed quote can be retried until it has used its retries', () => {
    expect(MAX_RETRIES).toBe(3)
    expect(canRetry({ status: 'failed', retries: 0 })).toBe(true)
    expect(canRetry({ status: 'failed', retries: MAX_RETRIES - 1 })).toBe(true)
    expect(canRetry({ status: 'failed', retries: MAX_RETRIES })).toBe(false)
  })
  test('a quote that was read, or is being read, cannot be retried', () => {
    for (const status of ['queued', 'processing', 'ready', 'needs_review'] as const) expect(canRetry({ status, retries: 0 })).toBe(false)
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
