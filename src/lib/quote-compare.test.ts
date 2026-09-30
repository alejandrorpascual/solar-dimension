import { describe, expect, test } from 'vitest'
import { compareQuotes, nothingRead, quoteName, type QuoteView } from './quote-compare'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES, type SampleQuoteId } from './quote-fixtures'
import { DEFAULT_MUSTS } from './quote-items'

const view = (id: string, over: Partial<QuoteView> = {}): QuoteView => ({
  id, fileName: `${id}.pdf`, label: null, status: 'ready',
  extraction: SAMPLE_QUOTES[id as SampleQuoteId] ?? null, overrides: {}, totalOverride: null, createdAt: 1, ...over,
})
const ALL = (['solartec', 'voltia', 'grupoluz', 'enerhogar'] as const).map((id, i) => view(id, { createdAt: i }))
const ids = (v: { quote: QuoteView }[]) => v.map((r) => r.quote.id)

describe('compareQuotes with the four sample quotes', () => {
  const v = compareQuotes(KIT, DEFAULT_MUSTS, ALL)
  test('SolarTec is the best fit and Voltia the next quote that fits', () => {
    expect(v.best?.quote.id).toBe('solartec')
    expect(v.best?.total).toBe(6480)
    expect(v.nextFit?.quote.id).toBe('voltia')
  })
  test('order: fits by total, then unclear, then short', () => {
    expect(ids(v.ranked)).toEqual(['solartec', 'voltia', 'grupoluz', 'enerhogar'])
    expect(v.ranked.map((r) => r.fit)).toEqual(['fits', 'fits', 'unclear', 'short'])
    expect(v.ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4])
  })
  test('deltas are against the best total', () => {
    expect(v.ranked.map((r) => r.delta)).toEqual([0, 820, -330, -530])
  })
  test('Grupo Luz is worth asking about its charger and fuse', () => {
    expect(ids(v.worthAsking)).toEqual(['grupoluz'])
    expect(v.ranked[2]!.unknownMusts).toEqual(['charger', 'fuse'])
  })
  test('EnerHogar fails its inverter, battery and cables', () => {
    expect(v.ranked[3]!.failedMusts).toEqual(['inverter', 'battery', 'cables'])
  })
  test('counts', () => {
    expect(v.mustCount).toBe(6)
    expect(v.readCount).toBe(4)
    expect(v.currency).toBe('USD')
  })
})

describe('must-haves and overrides change the winner', () => {
  test('charger and fuse as nice-to-haves make Grupo Luz the best fit', () => {
    const v = compareQuotes(KIT, { ...DEFAULT_MUSTS, charger: false, fuse: false }, ALL)
    expect(v.best?.quote.id).toBe('grupoluz')
    expect(v.nextFit?.quote.id).toBe('solartec')
  })
  test('confirming Grupo Luz charger and fuse makes it the best fit', () => {
    const quotes = ALL.map((q) => (q.id === 'grupoluz' ? { ...q, overrides: { charger: 'included' as const, fuse: 'included' as const } } : q))
    expect(compareQuotes(KIT, DEFAULT_MUSTS, quotes).best?.quote.id).toBe('grupoluz')
  })
})

describe('when nothing fits', () => {
  test('the closest short quote is named and nothing is best', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('enerhogar')])
    expect(v.best).toBeNull()
    expect(v.closest?.quote.id).toBe('enerhogar')
    expect(v.ranked[0]!.delta).toBeNull()
  })
  test('an unclear quote is worth asking even without a best', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('grupoluz')])
    expect(ids(v.worthAsking)).toEqual(['grupoluz'])
    expect(v.closest).toBeNull()
  })
})

describe('a quote with no total', () => {
  // A total of 0 is what the model writes when the quote states none: it must never rank as the cheapest.
  const noTotal = (id: SampleQuoteId, total: number) => view(id, { extraction: { ...SAMPLE_QUOTES[id], total } })
  test('a read quote whose total is 0, negative or not a number is unranked, waiting for the total to be entered', () => {
    for (const total of [0, -10, Number.NaN]) {
      const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), noTotal('grupoluz', total)])
      expect(ids(v.ranked), String(total)).toEqual(['solartec'])
      expect(v.unranked, String(total)).toMatchObject([{ quote: { id: 'grupoluz' }, reason: 'needs_review' }])
    }
  })
  test('it is never worth asking about, and never moves the deltas', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), view('voltia', { createdAt: 1 }), noTotal('grupoluz', 0), noTotal('enerhogar', 0)])
    expect(v.worthAsking).toEqual([])
    expect(v.best?.quote.id).toBe('solartec')
    expect(v.ranked.map((r) => r.delta)).toEqual([0, 820])
  })
  test('once the user enters its total, it ranks with it', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), { ...noTotal('voltia', 0), totalOverride: 6000 }])
    expect(v.best?.quote.id).toBe('voltia')
    expect(v.best?.total).toBe(6000)
  })
})

describe('what is not ranked', () => {
  test('queued and processing quotes are reading and not counted as read', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), view('x', { status: 'processing', extraction: null })])
    expect(v.unranked).toMatchObject([{ reason: 'reading' }])
    expect(v.readCount).toBe(1)
  })
  test('needs_review waits for a corrected total, then ranks with it', () => {
    const waiting = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { status: 'needs_review' })])
    expect(waiting.unranked).toMatchObject([{ reason: 'needs_review' }])
    const fixed = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { status: 'needs_review', totalOverride: 6000 })])
    expect(fixed.best?.total).toBe(6000)
  })
  test('failed quotes are counted as failed, not as read', () => {
    const failed = view('x', { status: 'failed', extraction: null })
    const onlyFailed = compareQuotes(KIT, DEFAULT_MUSTS, [failed, { ...failed, id: 'y' }])
    expect(onlyFailed.readCount).toBe(0)
    expect(onlyFailed.failedCount).toBe(2)
    const mixed = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), view('grupoluz', { status: 'needs_review' }), failed])
    expect(mixed.readCount).toBe(2)
    expect(mixed.failedCount).toBe(1)
  })
  test('nothing was read only when every finished quote failed and none is still reading', () => {
    const failed = view('x', { status: 'failed', extraction: null })
    const reading = view('r', { status: 'queued', extraction: null })
    expect(nothingRead(compareQuotes(KIT, DEFAULT_MUSTS, [failed]))).toBe(true)
    expect(nothingRead(compareQuotes(KIT, DEFAULT_MUSTS, [failed, view('solartec')]))).toBe(false)
    expect(nothingRead(compareQuotes(KIT, DEFAULT_MUSTS, [failed, reading]))).toBe(false)
    expect(nothingRead(compareQuotes(KIT, DEFAULT_MUSTS, []))).toBe(false)
  })
  test('failed quotes are listed as failed', () => {
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [view('x', { status: 'failed', extraction: null })]).unranked).toMatchObject([{ reason: 'failed' }])
  })
  test('a quote in another currency is listed but not ranked', () => {
    const eur = view('voltia', { extraction: { ...SAMPLE_QUOTES.voltia, currency: 'EUR' } })
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), view('grupoluz'), eur])
    expect(v.unranked).toMatchObject([{ quote: { id: 'voltia' }, reason: 'other_currency', currency: 'EUR' }])
  })
  test('a needs_review quote with a corrected total, in another currency, is other_currency and not needs_review', () => {
    const eur = view('voltia', { status: 'needs_review', totalOverride: 7000, extraction: { ...SAMPLE_QUOTES.voltia, currency: 'EUR' } })
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), view('grupoluz'), eur])
    expect(v.unranked).toMatchObject([{ quote: { id: 'voltia' }, reason: 'other_currency', currency: 'EUR' }])
  })
})

describe('ties and names', () => {
  test('equal totals: more nice-to-haves first', () => {
    const noWifi = extraction(SAMPLE_QUOTES.solartec.lines.filter((l) => l.kind !== 'monitoring'), { total: 6480, warranties: SAMPLE_QUOTES.solartec.warranties })
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('bare', { extraction: noWifi }), view('solartec')])
    expect(ids(v.ranked)).toEqual(['solartec', 'bare'])
  })
  test('the name is the label, then the vendor, then the file name', () => {
    expect(quoteName(view('solartec', { label: 'My pick' }))).toBe('My pick')
    expect(quoteName(view('solartec'))).toBe('SolarTec Caribe')
    expect(quoteName(view('x', { extraction: extraction([line('other', 1)]) }))).toBe('x.pdf')
  })
})
