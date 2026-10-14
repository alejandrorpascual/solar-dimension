import { describe, expect, test } from 'vitest'
import { SAMPLE_KIT as KIT, SAMPLE_QUOTES } from './quote-fixtures'
import { DEFAULT_MUSTS } from './quote-items'
import { etaSeconds, nextPollDelay, pickTray, summarizeProject, type JobQuote, type ProjectJobs } from './quote-jobs'

const jq = (id: string, over: Partial<JobQuote> = {}): JobQuote => ({
  id, fileName: `${id}.pdf`, label: null, status: 'ready', extraction: SAMPLE_QUOTES.solartec, overrides: {}, totalOverride: null,
  createdAt: 1, seenAt: null, retries: 0, ...over,
})
const jobs = (over: Partial<ProjectJobs>): ProjectJobs => ({
  projectId: 'p', projectName: 'Home', files: [], total: 1, done: 1, pending: 0, failed: 0, needsReview: 0, kitEmpty: false, unseen: false, best: null, ...over,
})

describe('summarizeProject', () => {
  test('counts pending, done, failed and needs-review quotes', () => {
    const s = summarizeProject('p', 'Home', [
      jq('a'), jq('b', { status: 'processing', extraction: null }), jq('c', { status: 'failed', extraction: null }), jq('d', { status: 'needs_review' }),
    ], KIT, DEFAULT_MUSTS)
    expect(s).toMatchObject({ total: 4, done: 3, pending: 1, failed: 1, needsReview: 1 })
    expect(s.files.map((f) => f.status)).toEqual(['ready', 'processing', 'failed', 'needs_review'])
  })
  test('a reading a typed total cannot fix still needs review', () => {
    const lineOff = { ...SAMPLE_QUOTES.solartec, lines: SAMPLE_QUOTES.solartec.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 1 } : l)) }
    const s = summarizeProject('p', 'Home', [
      jq('a', { status: 'needs_review', totalOverride: 6000 }), jq('b', { status: 'needs_review', extraction: lineOff, totalOverride: 6000 }),
    ], KIT, DEFAULT_MUSTS)
    expect(s.needsReview).toBe(1)
  })
  test("each file carries its retries, so the hand-off dialog can hide Retry once they're used up", () => {
    const s = summarizeProject('p', 'Home', [jq('a', { status: 'failed', extraction: null, retries: 3 })], KIT, DEFAULT_MUSTS)
    expect(s.files).toEqual([{ id: 'a', name: 'a.pdf', status: 'failed', retries: 3 }])
  })
  test('names the best quote only once nothing is pending', () => {
    expect(summarizeProject('p', 'Home', [jq('a'), jq('b', { status: 'queued', extraction: null })], KIT, DEFAULT_MUSTS).best).toBeNull()
    expect(summarizeProject('p', 'Home', [jq('a')], KIT, DEFAULT_MUSTS).best).toEqual({ name: 'SolarTec Caribe', optionLabel: null, total: 6480, currency: 'USD' })
  })
  test('names the option when the best entry is one', () => {
    const musts = { ...DEFAULT_MUSTS, battery: false, charger: false, cables: false, fuse: false, installation: false }
    const suna = jq('suna', { extraction: SAMPLE_QUOTES.suna })
    expect(summarizeProject('p', 'Home', [suna], KIT, musts).best).toEqual({ name: 'SUNA M.P.', optionLabel: 'Inversor 10 kW', total: 6200, currency: 'USD' })
  })
  test('an empty kit (null) is flagged, has no best, and is never an unseen verdict', () => {
    expect(summarizeProject('p', 'Home', [jq('a')], null, DEFAULT_MUSTS)).toMatchObject({ kitEmpty: true, best: null, unseen: false })
    expect(summarizeProject('p', 'Home', [jq('a')], KIT, DEFAULT_MUSTS).kitEmpty).toBe(false)
  })
  test('unseen while a finished quote has no seenAt', () => {
    expect(summarizeProject('p', 'Home', [jq('a')], KIT, DEFAULT_MUSTS).unseen).toBe(true)
    expect(summarizeProject('p', 'Home', [jq('a', { seenAt: 5 })], KIT, DEFAULT_MUSTS).unseen).toBe(false)
    expect(summarizeProject('p', 'Home', [jq('a', { status: 'queued', extraction: null })], KIT, DEFAULT_MUSTS).unseen).toBe(false)
  })
  test('failed-only project does not show unseen verdict ready', () => {
    const s = summarizeProject('p', 'Home', [jq('a', { status: 'failed', extraction: null })], KIT, DEFAULT_MUSTS)
    expect(s).toMatchObject({ unseen: false })
  })
  test('mixed ready and failed quotes shows unseen only for ready ones', () => {
    const s = summarizeProject('p', 'Home', [jq('a', { status: 'ready' }), jq('b', { status: 'failed', extraction: null })], KIT, DEFAULT_MUSTS)
    expect(s).toMatchObject({ unseen: true })
  })
})

describe('pickTray', () => {
  test('reading wins over ready', () => {
    const t = pickTray([jobs({ projectId: 'a', unseen: true }), jobs({ projectId: 'b', pending: 2 })], null)
    expect(t).toMatchObject({ mode: 'reading', project: { projectId: 'b' } })
  })
  test('ready when a finished verdict is unseen', () => {
    expect(pickTray([jobs({ unseen: true })], null)?.mode).toBe('ready')
  })
  test('hidden on the verdict page of that project, and when nothing is going on', () => {
    expect(pickTray([jobs({ pending: 1 })], 'p')).toBeNull()
    expect(pickTray([jobs({})], null)).toBeNull()
  })
  test('failed-only project shows no ready tray', () => {
    expect(pickTray([jobs({ failed: 1, unseen: false })], null)).toBeNull()
  })
})

describe('etaSeconds and nextPollDelay', () => {
  test('ETA only after the first quote is read', () => {
    expect(etaSeconds(jobs({ total: 4, done: 0, pending: 4 }))).toBeNull()
    expect(etaSeconds(jobs({ total: 4, done: 2, pending: 2 }))).toBe(60)
    expect(etaSeconds(jobs({ total: 4, done: 4, pending: 0 }))).toBeNull()
  })
  test('polls every 3 s while reading, backs off after a failure, stops when idle', () => {
    expect(nextPollDelay([jobs({ pending: 1 })], 0)).toBe(3000)
    expect(nextPollDelay([jobs({ pending: 1 })], 2)).toBe(10000)
    expect(nextPollDelay([], 1)).toBe(10000)
    expect(nextPollDelay([jobs({})], 0)).toBeNull()
  })
})
