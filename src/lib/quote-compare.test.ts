import { describe, expect, test } from 'vitest'
import { compareQuotes, entryKey, entryName, nothingRead, quoteName, quoteSubtitle, type QuoteView } from './quote-compare'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES, type SampleQuoteId } from './quote-fixtures'
import { DEFAULT_MUSTS } from './quote-items'

const view = (id: string, over: Partial<QuoteView> = {}): QuoteView => ({
  id, fileName: `${id}.pdf`, label: null, status: 'ready',
  extraction: SAMPLE_QUOTES[id as SampleQuoteId] ?? null, overrides: {}, totalOverride: null, createdAt: 1, retries: 0, ...over,
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
  test('a read quote whose total is 0, negative or not a number is unranked as no_total, waiting for the total', () => {
    for (const total of [0, -10, Number.NaN]) {
      for (const status of ['ready', 'needs_review'] as const) {
        const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec'), { ...noTotal('grupoluz', total), status }])
        expect(ids(v.ranked), `${total} ${status}`).toEqual(['solartec'])
        expect(v.unranked, `${total} ${status}`).toMatchObject([{ quote: { id: 'grupoluz' }, reason: 'no_total' }])
      }
    }
  })
  test('a quote whose amounts do not add up but that has a total stays needs_review', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { status: 'needs_review' })])
    expect(v.unranked).toMatchObject([{ reason: 'needs_review' }])
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
  test('a typed total ranks a reading only when its total was what failed (AI-11)', () => {
    const lineOff = { ...SAMPLE_QUOTES.solartec, lines: SAMPLE_QUOTES.solartec.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 1 } : l)) }
    const typed = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { status: 'needs_review', extraction: lineOff, totalOverride: 6480 })])
    expect(typed.ranked).toEqual([])
    expect(typed.unranked).toMatchObject([{ reason: 'misread' }])
    const totalOff = { ...SAMPLE_QUOTES.solartec, total: 648 }
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { status: 'needs_review', extraction: totalOff })]).unranked).toMatchObject([{ reason: 'needs_review' }])
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { status: 'needs_review', extraction: totalOff, totalOverride: 6480 })]).best?.total).toBe(6480)
  })
  test('once read again, a reading that still does not hold waits for the user\'s total and ranks on it', () => {
    // A discount taken off a line, or a quote with no lines at all, reads the same every time: without a total to type, it
    // could never be compared.
    const lineOff = { ...SAMPLE_QUOTES.solartec, lines: SAMPLE_QUOTES.solartec.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 1 } : l)) }
    const readAgain = view('solartec', { status: 'needs_review', extraction: lineOff, retries: 1 })
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [readAgain]).unranked).toMatchObject([{ reason: 'needs_review' }])
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [{ ...readAgain, totalOverride: 6480 }]).best?.total).toBe(6480)
    const noLines = view('x', { status: 'needs_review', extraction: extraction([], { total: 5000 }) })
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [noLines]).unranked).toMatchObject([{ reason: 'misread' }])
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [{ ...noLines, retries: 1 }]).unranked).toMatchObject([{ reason: 'needs_review' }])
  })
  test('a quote with options whose reading needs review still waits to be read again, as before', () => {
    const lineOff = { ...SAMPLE_QUOTES.suna, lines: SAMPLE_QUOTES.suna.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: 1 } : l)) }
    expect(compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { status: 'needs_review', extraction: lineOff })]).unranked).toMatchObject([{ reason: 'no_total', optionCount: 2 }])
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

describe('quoteSubtitle', () => {
  test('is the file name when the shown name comes from the vendor or a label', () => {
    expect(quoteSubtitle(view('solartec'))).toBe('solartec.pdf')
    expect(quoteSubtitle(view('solartec', { label: 'Roof job' }))).toBe('solartec.pdf')
  })
  test('is null when the shown name already is the file name', () => {
    expect(quoteSubtitle(view('unknown-vendor', { extraction: null }))).toBeNull()
  })
})

describe('a quote that offers two systems', () => {
  const suna = view('suna', { createdAt: 9 })
  const v = compareQuotes(KIT, DEFAULT_MUSTS, [suna])
  const keys = (es: { quote: QuoteView; optionId: string | null }[]) => es.map(entryKey)

  test('ranks one entry per option, priced on its own', () => {
    expect(keys(v.ranked).sort()).toEqual(['suna:o1', 'suna:o2'])
    const byKey = Object.fromEntries(v.ranked.map((r) => [entryKey(r), r]))
    expect(byKey['suna:o1']).toMatchObject({ total: 2600, optionLabel: 'Inversor 3 kW', optionCount: 2, name: 'SUNA M.P.' })
    expect(byKey['suna:o2']).toMatchObject({ total: 6200, optionLabel: 'Inversor 10 kW', optionCount: 2 })
  })
  test('only the 10 kW option can fit the kit: the 3 kW one is short of the inverter', () => {
    const byKey = Object.fromEntries(v.ranked.map((r) => [entryKey(r), r]))
    expect(byKey['suna:o1']!.fit).toBe('short')
    expect(byKey['suna:o1']!.failedMusts).toContain('inverter')
    expect(byKey['suna:o2']!.fit).toBe('unclear')
    expect(byKey['suna:o2']!.failedMusts).toEqual([])
  })
  test("each option is checked on its own lines: the 3 kW kit's batteries don't reach the 10 kW one", () => {
    const o2 = v.ranked.find((r) => r.optionId === 'o2')!
    expect(o2.items.find((c) => c.id === 'battery')!.status).toBe('unknown')
  })
  test('counts the file once', () => {
    expect(v.readCount).toBe(1)
    expect(v.currency).toBe('USD')
  })
  test('an override on the quote reaches both options', () => {
    const confirmed = compareQuotes(KIT, DEFAULT_MUSTS, [{ ...suna, overrides: { installation: 'included' } }])
    for (const r of confirmed.ranked) expect(r.items.find((c) => c.id === 'installation')!.status).toBe('ok')
  })
  test('an option with no price is unranked as no_price; the other still ranks', () => {
    const x = { ...SAMPLE_QUOTES.suna, lines: SAMPLE_QUOTES.suna.lines.map((l) => (l.option === 'o1' ? { ...l, lineTotal: 0 } : l)) }
    const u = compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { extraction: x })])
    expect(u.unranked.map((e) => [entryKey(e), e.reason])).toEqual([['suna:o1', 'no_price']])
    expect(keys(u.ranked)).toEqual(['suna:o2'])
  })
  test('an option that writes its own tax but no total ranks at its price with that tax', () => {
    const x = { ...SAMPLE_QUOTES.suna, options: SAMPLE_QUOTES.suna.options.map((o) => (o.id === 'o1' ? { ...o, tax: 416 } : o)) }
    const taxed = compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { extraction: x })])
    expect(taxed.ranked.find((r) => r.optionId === 'o1')).toMatchObject({ total: 3016 })
    expect(taxed.ranked.find((r) => r.optionId === 'o2')).toMatchObject({ total: 6200 })
  })
  test('the tax an option writes can change which quote is the best fit', () => {
    // Confirm what the 10 kW option leaves unclear, so it fits: untaxed, it is cheaper than SolarTec and wins.
    const plain = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { createdAt: 0 }), suna])
    const unclear = plain.ranked.find((r) => r.optionId === 'o2')!.items.filter((c) => c.status === 'unknown')
    const confirmed = { ...suna, overrides: Object.fromEntries(unclear.map((c) => [c.id, 'included'])) }
    const before = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { createdAt: 0 }), confirmed])
    expect(before.best && entryKey(before.best)).toBe('suna:o2')
    const solartecTotal = before.ranked.find((r) => r.quote.id === 'solartec')!.total!

    // Its written tax takes it past SolarTec's total: SolarTec is now the best fit.
    const tax = solartecTotal - 6200 + 500
    const x = { ...SAMPLE_QUOTES.suna, options: SAMPLE_QUOTES.suna.options.map((o) => (o.id === 'o2' ? { ...o, tax } : o)) }
    const after = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { createdAt: 0 }), { ...confirmed, extraction: x }])
    expect(after.best && entryKey(after.best)).toBe('solartec')
    expect(after.ranked.find((r) => r.optionId === 'o2')!.total).toBe(6200 + tax)
  })
  test("a quote's typed total never prices an option", () => {
    const x = { ...SAMPLE_QUOTES.suna, lines: SAMPLE_QUOTES.suna.lines.map((l) => (l.option === 'o1' ? { ...l, lineTotal: 0 } : l)) }
    const u = compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { extraction: x, totalOverride: 9000 })])
    expect(u.unranked.map((e) => e.reason)).toEqual(['no_price'])
  })
  test('a quote with options whose numbers need checking stays one card, waiting, with its option count', () => {
    const u = compareQuotes(KIT, DEFAULT_MUSTS, [view('suna', { status: 'needs_review' })])
    expect(u.ranked).toEqual([])
    expect(u.unranked).toHaveLength(1)
    expect(u.unranked[0]).toMatchObject({ reason: 'no_total', optionId: null, optionCount: 2 })
  })
  test('ranks options alongside other quotes: the 10 kW option is cheaper than SolarTec but unclear, so worth asking', () => {
    const both = compareQuotes(KIT, DEFAULT_MUSTS, [view('solartec', { createdAt: 0 }), suna])
    expect(both.best?.quote.id).toBe('solartec')
    expect(keys(both.worthAsking)).toEqual(['suna:o2'])
  })
})

describe('entryKey and entryName', () => {
  test('a single-system quote is its id and its name', () => {
    expect(entryKey({ quote: { id: 'q1' }, optionId: null })).toBe('q1')
    expect(entryName({ name: 'SolarTec Caribe', optionLabel: null })).toBe('SolarTec Caribe')
  })
  test('an option adds its id to the key and its label to the name', () => {
    expect(entryKey({ quote: { id: 'q1' }, optionId: 'o2' })).toBe('q1:o2')
    expect(entryName({ name: 'SUNA M.P.', optionLabel: 'Inversor 10 kW' })).toBe('SUNA M.P. · Inversor 10 kW')
  })
  test('single-system entries carry no option', () => {
    const v = compareQuotes(KIT, DEFAULT_MUSTS, ALL)
    for (const r of v.ranked) expect(r).toMatchObject({ optionId: null, optionLabel: null, optionCount: 0 })
  })
})
