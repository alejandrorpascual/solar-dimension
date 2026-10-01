import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_QUOTES } from './quote-fixtures'
import { hasOptions, optionExtraction, optionLines } from './quote-options'

describe('options of a quote', () => {
  const x = extraction(
    [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' }), line('labor', 50)],
    { options: [{ id: 'a', label: 'A', total: null }, { id: 'b', label: 'B', total: null }] },
  )
  test('a quote offers options when it lists two or more', () => {
    expect(hasOptions(x)).toBe(true)
    expect(hasOptions(SAMPLE_QUOTES.solartec)).toBe(false)
  })
  test("an option's lines are its own and the shared ones", () => {
    expect(optionLines(x, 'a').map((l) => l.lineTotal)).toEqual([100, 50])
    expect(optionLines(x, 'b').map((l) => l.lineTotal)).toEqual([200, 50])
  })
  test('the quote as if it offered one option keeps everything else', () => {
    const a = optionExtraction(x, 'a')
    expect(a.lines).toHaveLength(2)
    expect(a.currency).toBe(x.currency)
    expect(x.lines).toHaveLength(3)
  })
})
