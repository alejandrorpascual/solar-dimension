import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read = (name: string): Buffer => readFileSync(new URL(`../../public/${name}`, import.meta.url))

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const IHDR_WIDTH_AT = 16
const IHDR_HEIGHT_AT = 20

describe('the files a shared link and a browser tab fetch', () => {
  test('og.png is a PNG of 1200 x 630 pixels', () => {
    const png = read('og.png')
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
    expect(png.readUInt32BE(IHDR_WIDTH_AT)).toBe(1200)
    expect(png.readUInt32BE(IHDR_HEIGHT_AT)).toBe(630)
  })

  test('favicon.ico is an icon file that holds at least one image', () => {
    const ico = read('favicon.ico')
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(1)
  })

  test('icon.svg is an SVG document', () => {
    expect(read('icon.svg').toString('utf8')).toMatch(/^<svg[\s>]/)
  })
})
