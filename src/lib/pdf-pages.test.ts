import { describe, expect, test } from 'vitest'
import { pageSlices } from './pdf-pages'

const row = (top: number, height = 40) => ({ top, bottom: top + height })

describe('pageSlices', () => {
  test('a sheet that fits is one slice', () => {
    expect(pageSlices([row(0), row(40)], 900, 1000)).toEqual([{ start: 0, end: 900 }])
  })

  test('a row crossing the page edge moves whole to the next page', () => {
    const blocks = [row(900), row(980), row(1020)]
    expect(pageSlices(blocks, 1100, 1000)).toEqual([{ start: 0, end: 980 }, { start: 980, end: 1100 }])
  })

  test('a heading stays with the row after it', () => {
    const blocks = [{ top: 950, bottom: 990, keepWithNext: true }, row(990), row(1030)]
    expect(pageSlices(blocks, 1100, 1000)).toEqual([{ start: 0, end: 950 }, { start: 950, end: 1100 }])
  })

  test('a block taller than a page is cut at the page edge rather than looping', () => {
    const slices = pageSlices([{ top: 0, bottom: 2500 }], 2500, 1000)
    expect(slices).toEqual([{ start: 0, end: 1000 }, { start: 1000, end: 2000 }, { start: 2000, end: 2500 }])
  })

  test('blocks arrive in any order', () => {
    const blocks = [row(1020), row(900), row(980)]
    expect(pageSlices(blocks, 1100, 1000)[0]).toEqual({ start: 0, end: 980 })
  })
})
