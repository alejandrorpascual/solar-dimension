import { describe, expect, test } from 'vitest'
import { pageSlices } from './pdf-pages'

const row = (top: number, height = 40) => ({ top, bottom: top + height })

describe('pageSlices', () => {
  test('trailing padding does not create an empty page', () => {
    expect(pageSlices([row(0), row(950)], 1038, 1000)).toEqual([{ start: 0, end: 1000 }])
  })

  test('content ending exactly at the page edge does not add a blank page', () => {
    expect(pageSlices([row(960)], 1048, 1000)).toEqual([{ start: 0, end: 1000 }])
  })

  test('only trailing whitespace is trimmed in a multipage document', () => {
    expect(pageSlices([row(0), row(1000), row(1960)], 2048, 1000)).toEqual([
      { start: 0, end: 1000 }, { start: 1000, end: 2000 },
    ])
  })

  test('an unpaired keep block at the end is still content', () => {
    expect(pageSlices([row(0), { top: 990, bottom: 1050, keepWithNext: true }], 1098, 1000)).toEqual([
      { start: 0, end: 990 }, { start: 990, end: 1098 },
    ])
  })

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

  test('a block marked to start a page starts one, even with room left', () => {
    const blocks = [row(0), row(300), { top: 500, bottom: 540, keepWithNext: true, breakBefore: true }, row(540), row(580)]
    expect(pageSlices(blocks, 700, 1000)).toEqual([{ start: 0, end: 500 }, { start: 500, end: 700 }])
  })

  test('a page break at the very top of a page adds no empty page', () => {
    expect(pageSlices([{ top: 0, bottom: 40, breakBefore: true }, row(40)], 100, 1000)).toEqual([{ start: 0, end: 100 }])
  })

  test('content after a page break still flows onto more pages when it is long', () => {
    const blocks = [row(0), { top: 200, bottom: 240, breakBefore: true }, row(1100), row(1180)]
    expect(pageSlices(blocks, 1260, 1000)).toEqual([{ start: 0, end: 200 }, { start: 200, end: 1180 }, { start: 1180, end: 1260 }])
  })

  test('pages after the first leave room for their top margin', () => {
    const blocks = [row(0), { top: 200, bottom: 240, breakBefore: true }, row(1100), row(1150)]
    // Page 2 holds 1000 - 60 = 940: the row at 1100 still fits (ends 1140 = 200 + 940), the one at 1150 moves on.
    expect(pageSlices(blocks, 1260, 1000, 60)).toEqual([{ start: 0, end: 200 }, { start: 200, end: 1140 }, { start: 1140, end: 1260 }])
  })
})
