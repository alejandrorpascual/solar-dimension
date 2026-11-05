import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import type { KitCheck } from '../lib/kit-checks'
import { ChecksList } from './ChecksList'

const check = (id: string, status: KitCheck['status']) => ({ id, name: id, status, lines: [`${id} line`] }) as KitCheck
const html = (checks: KitCheck[], locale: 'en' | 'es' = 'en') => renderToStaticMarkup(createElement(ChecksList, { checks, t: getDictionary(locale) }))

test('when every check passes they fold to one line that says so, in English and Spanish', () => {
  const passing = [check('a', 'pass'), check('b', 'pass')]
  expect(html(passing)).toMatch(/<details class="elec"><summary[^>]*>.*All 2 pass.*<\/summary>/)
  expect(html(passing, 'es')).toContain('Las 2 cumplen')
  expect(html(passing)).toContain('a line')
})

test('when any check needs attention the whole list stays out, with no line to open', () => {
  const mixed = html([check('a', 'pass'), check('b', 'warn')])
  expect(mixed).not.toContain('<details')
  expect(mixed).toContain('a line')
  expect(mixed).toContain('b line')
})
