import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES_DIR = __dirname
const sheets = readdirSync(STYLES_DIR)
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({ file, css: readFileSync(join(STYLES_DIR, file), 'utf8') }))

describe('stylesheets', () => {
  it('never transition width, which lays the page out on every frame', () => {
    const offenders = sheets.flatMap(({ file, css }) =>
      css.split('\n').flatMap((line, i) => (/transition[^;}]*\bwidth\b/.test(line) ? [`${file}:${i + 1}`] : [])),
    )
    expect(offenders).toEqual([])
  })

  it('stills the card load bar for reduced motion, as the quotes tray bar is', () => {
    const rail = sheets.find((s) => s.file === 'rail.css')?.css ?? ''
    const reduced = rail.split('@media (prefers-reduced-motion: reduce)').slice(1).join('\n')
    expect(reduced).toMatch(/\.pcard__bar > span[^{]*\{[^}]*transition: none/)
  })
})
