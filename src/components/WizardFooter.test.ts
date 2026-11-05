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
const footerHtml = (step: Step, attention: string | null, nextLocked: string | null = null) =>
  renderToStaticMarkup(createElement(WizardFooter, { step, summary: '1 battery', attention, nextLocked, onBack: noop, onNext: noop, onDownload: noop }))

test('on the kit step the footer carries the attention line next to its summary, as a button to the checks', () => {
  expect(footerHtml(4, '2 checks need attention')).toMatch(/<button type="button" class="attn"[^>]*>.*2 checks need attention<\/span><\/button><div class="num muted footer__summary">1 battery<\/div>/)
})

test('the footer shows no attention line before the kit step, or when every check passes', () => {
  expect(footerHtml(3, '2 checks need attention')).not.toContain('class="attn"')
  expect(footerHtml(4, null)).not.toContain('class="attn"')
})

/** The class list of the footer button labelled `label`. */
const buttonClass = (html: string, label: string) => new RegExp(`<button type="button" class="([^"]*)"[^>]*>(?:<svg[\\s\\S]*?</svg>)?${label}</button>`).exec(html)?.[1]

test('on the kit step Download is the primary button and Back the same secondary one as on the steps before', () => {
  const html = footerHtml(4, null)
  expect(buttonClass(html, 'Download')?.split(' ')).toContain('btn--primary')
  expect(buttonClass(html, 'Back')?.split(' ')).toEqual(['btn'])
  expect(html).not.toContain('Start over')
})

test('step 1 has nothing to go back to', () => {
  expect(buttonClass(footerHtml(1, null), 'Back')).toBeUndefined()
})

test('with no appliances Next is off and says why, as the stepper does', () => {
  const locked = footerHtml(1, null, 'Add at least one appliance first')
  expect(locked).toMatch(/<button[^>]*disabled=""[^>]*title="Add at least one appliance first"[^>]*>Next: backup window/)
  expect(footerHtml(1, null)).not.toMatch(/<button[^>]*disabled/)
})

test('the slim summary sits beside the full one for the stylesheet to choose between, and is left out when not given', () => {
  const html = renderToStaticMarkup(createElement(WizardFooter, { step: 1, summary: 'Home · 6 appliances', summarySlim: '6 appliances', attention: null, nextLocked: null, onBack: noop, onNext: noop, onDownload: noop }))
  expect(html).toContain('<span class="footer__wide">Home · 6 appliances</span><span class="footer__slim">6 appliances</span>')
  expect(footerHtml(1, null)).not.toContain('footer__slim')
})
