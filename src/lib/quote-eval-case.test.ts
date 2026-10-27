import { describe, expect, test } from 'vitest'
import { loadCases } from '../../eval/quotes/load-cases'
import { caseProblems, EvalCaseSchema, type EvalCase } from './quote-eval-case'
import { extraction, line } from './quote-fixtures'

const QUOTE = extraction([line('inverter', 900, { specs: { watts: 3000 } }), line('labor', 0)], { total: 0 })

const MANIFEST: EvalCase = {
  title: 'Incomplete quote',
  spec: 'A8 case 8',
  document: { source: 'generated', file: '08-incomplete.pdf', uploadName: 'cotizacion.pdf' },
  status: 'needs_review',
  expectedNull: ['lines[0].specs.surgeWatts', 'date'],
  unscored: ['currency', 'lines[*].source.page'],
  notesMention: [],
  pending: [{ path: 'total', today: '0', after: 'null', change: 'AI-09' }],
  notes: [],
}

describe('EvalCaseSchema', () => {
  test('takes a full manifest', () => {
    expect(EvalCaseSchema.parse(MANIFEST)).toEqual(MANIFEST)
  })
  test('refuses a document outside eval/quotes/documents/, an unknown key and an empty notes group', () => {
    for (const file of ['../.env.local', 'sub/a.pdf', '..', 'a']) {
      expect(EvalCaseSchema.safeParse({ ...MANIFEST, document: { ...MANIFEST.document, file } }).success, file).toBe(false)
    }
    expect(EvalCaseSchema.safeParse({ ...MANIFEST, extra: 1 }).success).toBe(false)
    expect(EvalCaseSchema.safeParse({ ...MANIFEST, notesMention: [[]] }).success).toBe(false)
  })
})

describe('caseProblems', () => {
  test('none for a manifest true to its expected reading', () => {
    expect(caseProblems(MANIFEST, QUOTE)).toEqual([])
  })
  test('a field listed as expected null that holds a value, or names no field', () => {
    expect(caseProblems({ ...MANIFEST, expectedNull: ['lines[0].specs.watts', 'lines[5].specs.kWh'] }, QUOTE)).toEqual([
      'expectedNull lines[0].specs.watts is 3000 in expected.json',
      'expectedNull lines[5].specs.kWh names no field of expected.json',
    ])
  })
  test('an unscored or pending path that names no field', () => {
    expect(caseProblems({ ...MANIFEST, unscored: ['lines[*].specs.kwh'], pending: [{ ...MANIFEST.pending[0], path: 'totl' }] }, QUOTE)).toEqual([
      'unscored lines[*].specs.kwh names no field of expected.json',
      'pending totl names no field of expected.json',
    ])
  })
  test('a status other than the one the app gives the expected reading', () => {
    expect(caseProblems({ ...MANIFEST, status: 'ready' }, QUOTE)).toEqual([
      'status is ready, but the app gives expected.json needs_review (no_total)',
    ])
    expect(caseProblems({ ...MANIFEST, status: null }, QUOTE)).toEqual([])
  })
  test('notes the case expects that its own expected reading does not mention', () => {
    const noted = { ...QUOTE, notes: ['El pico está en VA.'] }
    expect(caseProblems({ ...MANIFEST, notesMention: [['VA']] }, noted)).toEqual([])
    expect(caseProblems({ ...MANIFEST, notesMention: [['VA'], ['obra civil', 'breaker']] }, noted)).toEqual([
      'notesMention asks for 2 groups, but the notes of expected.json mention 1',
    ])
  })
  test('a pending entry may be about the status', () => {
    expect(caseProblems({ ...MANIFEST, pending: [{ ...MANIFEST.pending[0], path: 'status' }] }, QUOTE)).toEqual([])
  })
})

describe('the golden set in eval/quotes/cases', () => {
  const cases = loadCases()
  const bySlug = new Map(cases.map((c) => [c.slug, c]))

  test('has the twelve cases of A8, case 11 in both its variants', () => {
    const numbers = new Set(cases.map((c) => c.slug.slice(0, 2)))
    expect([...numbers].sort()).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'])
    expect(bySlug.has('11-embedded-instructions-pdf') && bySlug.has('11-embedded-instructions-image')).toBe(true)
  })
  test('cases 2 and 11 expect exactly the reading of case 1 (A8)', () => {
    const clean = bySlug.get('01-clean-itemised-usd')?.expected
    for (const slug of ['02-phone-photo', '11-embedded-instructions-pdf', '11-embedded-instructions-image']) {
      expect(bySlug.get(slug)?.expected, slug).toEqual(clean)
    }
  })
  test('each case gives the model a neutral file name, so a case name such as "embedded instructions" gives nothing away', () => {
    for (const c of cases) expect(c.manifest.document.uploadName, c.slug).toMatch(/^(cotizacion|quote)\.(pdf|jpg|png|webp)$/)
  })
})
