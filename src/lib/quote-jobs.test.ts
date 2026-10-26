import { describe, expect, test } from 'vitest'
import { SAMPLE_KIT as KIT, SAMPLE_QUOTES } from './quote-fixtures'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { DEFAULT_MUSTS, quoteKit, type QuoteKit } from './quote-items'
import {
  DEFAULT_POLL_MS, etaSeconds, finishedKey, MAX_POLL_MS, MIN_POLL_MS, nextPollDelay, parsePollMs, pickTray, summarizeProject,
  verdictReload, type JobQuote, type ProjectJobs,
} from './quote-jobs'
import { compute } from './sizing'

const jq = (id: string, over: Partial<JobQuote> = {}): JobQuote => ({
  id, fileName: `${id}.pdf`, label: null, status: 'ready', extraction: SAMPLE_QUOTES.solartec, overrides: {}, totalOverride: null,
  createdAt: 1, seenAt: null, retries: 0, pages: null, fileHash: null, ...over,
})
const jobs = (over: Partial<ProjectJobs>): ProjectJobs => ({
  projectId: 'p', projectName: 'Home', files: [], total: 1, done: 1, pending: 0, failed: 0, needsReview: 0, kitHold: null, unseen: false, best: null, ...over,
})

const OK: QuoteKit = { hold: null, needs: KIT }

describe('summarizeProject', () => {
  test('counts pending, done, failed and needs-review quotes', () => {
    const s = summarizeProject('p', 'Home', [
      jq('a'), jq('b', { status: 'processing', extraction: null }), jq('c', { status: 'failed', extraction: null }), jq('d', { status: 'needs_review' }),
    ], OK, DEFAULT_MUSTS)
    expect(s).toMatchObject({ total: 4, done: 3, pending: 1, failed: 1, needsReview: 1 })
    expect(s.files.map((f) => f.status)).toEqual(['ready', 'processing', 'failed', 'needs_review'])
  })
  test('a reading a typed total cannot fix still needs review, until it has been read again', () => {
    const lineOff = { ...SAMPLE_QUOTES.solartec, lines: SAMPLE_QUOTES.solartec.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 1 } : l)) }
    const s = summarizeProject('p', 'Home', [
      jq('a', { status: 'needs_review', totalOverride: 6000 }), jq('b', { status: 'needs_review', extraction: lineOff, totalOverride: 6000 }),
      jq('c', { status: 'needs_review', extraction: lineOff, totalOverride: 6000, retries: 1 }),
    ], OK, DEFAULT_MUSTS)
    expect(s.needsReview).toBe(1)
  })
  test("each file carries its retries, so the hand-off dialog can hide Retry once they're used up", () => {
    const s = summarizeProject('p', 'Home', [jq('a', { status: 'failed', extraction: null, retries: 3 })], OK, DEFAULT_MUSTS)
    expect(s.files).toEqual([{ id: 'a', name: 'a.pdf', status: 'failed', retries: 3 }])
  })
  test('names the best quote only once nothing is pending', () => {
    expect(summarizeProject('p', 'Home', [jq('a'), jq('b', { status: 'queued', extraction: null })], OK, DEFAULT_MUSTS).best).toBeNull()
    expect(summarizeProject('p', 'Home', [jq('a')], OK, DEFAULT_MUSTS).best).toEqual({ name: 'SolarTec Caribe', optionLabel: null, total: 6480, currency: 'USD' })
  })
  test('names the option when the best entry is one', () => {
    const musts = { ...DEFAULT_MUSTS, battery: false, charger: false, cables: false, fuse: false, installation: false }
    const suna = jq('suna', { extraction: SAMPLE_QUOTES.suna })
    expect(summarizeProject('p', 'Home', [suna], OK, musts).best).toEqual({ name: 'SUNA M.P.', optionLabel: 'Inversor 10 kW', total: 6200, currency: 'USD' })
  })
  test('a held kit is flagged, has no best, and is never an unseen verdict', () => {
    const empty = quoteKit(compute({ qty: {}, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT))
    expect(summarizeProject('p', 'Home', [jq('a')], empty, DEFAULT_MUSTS)).toMatchObject({ kitHold: 'empty', best: null, unseen: false })
    expect(summarizeProject('p', 'Home', [jq('a')], OK, DEFAULT_MUSTS).kitHold).toBeNull()
  })
  test('a kit missing an appliance has no best and nothing unseen, as an empty kit (#204)', () => {
    const qty = { fridge: 1, lights: 1, router: 1, tv: 1, 'no-such-thing': 1 }
    const missing = quoteKit(compute({ qty, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT))
    expect(summarizeProject('p', 'Home', [jq('a')], missing, DEFAULT_MUSTS)).toMatchObject({ kitHold: 'missing', best: null, unseen: false })
  })
  test('unseen while a finished quote has no seenAt', () => {
    expect(summarizeProject('p', 'Home', [jq('a')], OK, DEFAULT_MUSTS).unseen).toBe(true)
    expect(summarizeProject('p', 'Home', [jq('a', { seenAt: 5 })], OK, DEFAULT_MUSTS).unseen).toBe(false)
    expect(summarizeProject('p', 'Home', [jq('a', { status: 'queued', extraction: null })], OK, DEFAULT_MUSTS).unseen).toBe(false)
  })
  test('failed-only project does not show unseen verdict ready', () => {
    const s = summarizeProject('p', 'Home', [jq('a', { status: 'failed', extraction: null })], OK, DEFAULT_MUSTS)
    expect(s).toMatchObject({ unseen: false })
  })
  test('mixed ready and failed quotes shows unseen only for ready ones', () => {
    const s = summarizeProject('p', 'Home', [jq('a', { status: 'ready' }), jq('b', { status: 'failed', extraction: null })], OK, DEFAULT_MUSTS)
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
  test('polls at the interval it is given while reading, backs off after a failure, stops when idle', () => {
    expect(nextPollDelay([jobs({ pending: 1 })], 0, 3000)).toBe(3000)
    expect(nextPollDelay([jobs({ pending: 1 })], 0, 500)).toBe(500)
    expect(nextPollDelay([jobs({ pending: 1 })], 2, 500)).toBe(10000)
    expect(nextPollDelay([], 1, 500)).toBe(10000)
    expect(nextPollDelay([jobs({})], 0, 500)).toBeNull()
  })
})

describe('finishedKey', () => {
  const q = (id: string, status: JobQuote['status'], retries = 0) => ({ id, status, retries })

  test('is the same for the same quotes, in any order', () => {
    expect(finishedKey([q('a', 'ready'), q('b', 'failed')])).toBe(finishedKey([q('b', 'failed'), q('a', 'ready')]))
  })
  test('changes when a quote finishes, though as many are done as before it was read again', () => {
    expect(finishedKey([q('a', 'ready'), q('b', 'needs_review')])).not.toBe(finishedKey([q('a', 'ready'), q('b', 'ready', 1)]))
  })
  test('changes when a retry fails again', () => {
    expect(finishedKey([q('a', 'failed', 1)])).not.toBe(finishedKey([q('a', 'failed', 2)]))
  })
  test('does not change while a quote moves from waiting to being read', () => {
    expect(finishedKey([q('a', 'queued', 1)])).toBe(finishedKey([q('a', 'processing', 1)]))
  })
  test('changes when a quote is added or deleted', () => {
    expect(finishedKey([q('a', 'ready')])).not.toBe(finishedKey([q('a', 'ready'), q('b', 'queued')]))
  })
})

describe('verdictReload', () => {
  const A = { projectId: 'a', key: 'q1:ready:0' }

  test('reloads when the jobs of the open project change, and remembers them', () => {
    expect(verdictReload(A, 'a', 'q1:ready:0', 'q1:pending:1')).toEqual({ mark: { projectId: 'a', key: 'q1:pending:1' }, reload: true })
  })
  test('does not reload while the jobs match what it last read', () => {
    expect(verdictReload(A, 'a', 'q1:ready:0', 'q1:ready:0')).toEqual({ mark: A, reload: false })
  })
  test('a project opened in place starts from what its own loader read, so its first poll does not read again', () => {
    expect(verdictReload(A, 'b', 'q9:ready:0', 'q9:ready:0')).toEqual({ mark: { projectId: 'b', key: 'q9:ready:0' }, reload: false })
  })
  test('a project opened in place whose quotes moved since its loader read them reloads', () => {
    expect(verdictReload(A, 'b', 'q9:pending:0', 'q9:ready:0')).toEqual({ mark: { projectId: 'b', key: 'q9:ready:0' }, reload: true })
  })
  test('does nothing before the jobs have loaded', () => {
    expect(verdictReload(A, 'b', 'q9:ready:0', '')).toEqual({ mark: { projectId: 'b', key: 'q9:ready:0' }, reload: false })
  })
})

describe('parsePollMs', () => {
  test('unset or blank polls every 3 s, and is not an error', () => {
    expect(parsePollMs(undefined)).toEqual({ pollMs: 3000, isInvalid: false })
    expect(parsePollMs('')).toEqual({ pollMs: 3000, isInvalid: false })
    expect(parsePollMs('  ')).toEqual({ pollMs: 3000, isInvalid: false })
  })
  test('a whole number of milliseconds is the interval, spaces trimmed', () => {
    expect(parsePollMs('500')).toEqual({ pollMs: 500, isInvalid: false })
    expect(parsePollMs(` ${MIN_POLL_MS} `)).toEqual({ pollMs: MIN_POLL_MS, isInvalid: false })
  })
  test('up to a minute is taken', () => {
    expect(parsePollMs(String(MAX_POLL_MS))).toEqual({ pollMs: MAX_POLL_MS, isInvalid: false })
  })
  test('outside 100 ms to a minute, or anything but a whole number, falls back to 3 s and says so', () => {
    const outside = [String(MIN_POLL_MS - 1), String(MAX_POLL_MS + 1), '99999999999', '0', '-500']
    for (const raw of [...outside, '1.5', '1e3', '500ms', 'fast']) {
      expect(parsePollMs(raw), raw).toEqual({ pollMs: DEFAULT_POLL_MS, isInvalid: true })
    }
  })
})
