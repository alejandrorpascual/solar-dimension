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

  it('times every transition and animation with a motion token from tokens.css', () => {
    const offenders = sheets
      .filter(({ file }) => file !== 'tokens.css')
      .flatMap(({ file, css }) =>
        css.split('\n').flatMap((line, i) =>
          /(transition|animation)\s*:[^;}]*\b\d*\.?\d+m?s\b/.test(line) ? [`${file}:${i + 1}`] : [],
        ),
      )
    expect(offenders).toEqual([])
  })

  it('defines the motion tokens once, in tokens.css', () => {
    const tokens = sheets.find((s) => s.file === 'tokens.css')?.css ?? ''
    for (const name of ['--dur-fast', '--dur-base', '--dur-sheet', '--dur-spin', '--ease-out', '--ease-in', '--ease-sheet']) {
      expect(tokens).toMatch(new RegExp(`${name}:`))
    }
  })

  it('eases the hover of buttons, chips and links with the tile token, and rings their keyboard focus like the stepper', () => {
    const base = sheets.find((s) => s.file === 'base.css')?.css ?? ''
    const hover = base.match(/:where\(([^)]*)\)\s*\{[^}]*transition:[^}]*var\(--dur-fast\)/)
    const ring = base.match(/:where\(([^)]*)\):focus-visible\s*\{[^}]*outline: 2px solid var\(--accent\)/)
    for (const selector of ['a', '.btn', '.chip']) expect(hover?.[1].split(/,\s*/)).toContain(selector)
    for (const selector of ['a', 'button', 'select', '.chip']) expect(ring?.[1].split(/,\s*/)).toContain(selector)
    const solar = sheets.find((s) => s.file === 'solar.css')?.css ?? ''
    expect(solar).toMatch(/\.tile \{[^}]*transition:[^}]*var\(--dur-fast\)/)
  })

  it('turns motion off in every reduced-motion block', () => {
    const blocks = sheets.flatMap(({ file, css }) => css.split('@media (prefers-reduced-motion: reduce)').slice(1).map((rest) => ({ file, rest: rest.slice(0, rest.indexOf('}\n') + 1 || undefined) })))
    expect(blocks.length).toBeGreaterThan(0)
    for (const { file, rest } of blocks) expect(rest, file).toMatch(/(transition|animation): none/)
  })
})
