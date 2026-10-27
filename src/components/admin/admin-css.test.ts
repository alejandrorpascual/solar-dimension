import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const css = readFileSync(join(__dirname, 'admin.css'), 'utf8')
const lines = css.split('\n').map((line, i) => ({ line, at: `admin.css:${i + 1}` }))
const offending = (pattern: RegExp) => lines.filter(({ line }) => pattern.test(line)).map(({ at, line }) => `${at} ${line.trim()}`)

test('admin.css writes no color of its own: every color is a tokens.css variable', () => {
  expect(offending(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i)).toEqual([])
})

test('admin.css takes every radius from the tokens', () => {
  expect(offending(/border-radius\s*:(?!\s*var\(--radius-(sm|md|lg)\)\s*[;}])/)).toEqual([])
})

test('admin.css sets no type size: text sizes come from the shared classes', () => {
  expect(offending(/font-size\s*:/)).toEqual([])
})

test('admin cards sit on the surface color with a token radius, like the kit screens', () => {
  for (const card of ['.admin__form', '.admin__box']) {
    const rule = new RegExp(`${card.replace('.', '\\.')} \\{[^}]*\\}`).exec(css)?.[0] ?? ''
    expect(rule, card).toMatch(/background: var\(--surface\)/)
    expect(rule, card).toMatch(/border-radius: var\(--radius-md\)/)
  }
})

test('a wide table scrolls inside its own box, not the page', () => {
  expect(css).toMatch(/\.admin__box \{[^}]*overflow-x: auto/)
})
