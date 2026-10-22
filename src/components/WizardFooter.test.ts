import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import type { Step } from './Stepper'
import { WizardFooter } from './WizardFooter'

vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: 'en', t: getDictionary('en') }) }
})

const noop = () => {}
const footerHtml = (step: Step, attention: string | null) =>
  renderToStaticMarkup(createElement(WizardFooter, { step, summary: '1 battery', attention, onBack: noop, onNext: noop, onStartOver: noop, onDownload: noop }))

test('on the kit step the footer carries the attention line next to its summary, as a button to the checks', () => {
  expect(footerHtml(4, '2 checks need attention')).toMatch(/<button type="button" class="attn"[^>]*>.*2 checks need attention<\/span><\/button><div class="num muted footer__summary">1 battery<\/div>/)
})

test('the footer shows no attention line before the kit step, or when every check passes', () => {
  expect(footerHtml(3, '2 checks need attention')).not.toContain('class="attn"')
  expect(footerHtml(4, null)).not.toContain('class="attn"')
})

/** The class list of the footer button labelled `label`. */
const buttonClass = (html: string, label: string) => new RegExp(`<button type="button" class="([^"]*)"[^>]*>(?:<svg[\\s\\S]*?</svg>)?${label}</button>`).exec(html)?.[1]

test('on the kit step Download is the primary button and Start over a secondary one', () => {
  const html = footerHtml(4, null)
  expect(buttonClass(html, 'Download')?.split(' ')).toContain('btn--primary')
  expect(buttonClass(html, 'Start over')?.split(' ')).toEqual(['btn'])
})
