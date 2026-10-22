import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { Locale } from '../i18n'
import { InlineConfirm } from './InlineConfirm'
import { ConfirmDelete } from './quotes/ConfirmDelete'
import { QuoteActions } from './quotes/QuoteActions'

/**
 * The language the question renders in, and whether a quote's Delete has been chosen. The root route's data is not
 * there outside the app, so the locale hook is stood in for; a static render runs no click, so useAskFirst is told
 * whether it is asking. InlineConfirm itself is the real one.
 */
const view = vi.hoisted(() => ({ locale: 'en' as Locale, isAsking: false }))
vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: view.locale, t: getDictionary(view.locale) }) }
})
vi.mock('./InlineConfirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./InlineConfirm')>()),
  useAskFirst: () => ({ isAsking: view.isAsking, askerRef: { current: null }, ask: () => {}, cancel: () => {} }),
}))

const noop = () => {}

function render(locale: Locale, isAsking: boolean, element: ReturnType<typeof createElement>): string {
  view.locale = locale
  view.isAsking = isAsking
  return renderToStaticMarkup(element)
}

// The markup each confirm had before #174 shared it (staging at be43894): the question as an alert, then the red yes
// and Cancel, with the same classes, so no confirm moves on screen and the e2e locators keep finding them.
describe('a quote on the verdict (QuoteActions)', () => {
  const actions = (optionCount: number) => createElement(QuoteActions, { quoteId: 'q1', optionCount, onDelete: noop })
  const original = (label: string) => `<a class="qbtn" href="/api/quotes/q1/file" target="_blank" rel="noopener noreferrer">${label}</a>`

  test('asks the same question with the same answers, in English and Spanish', () => {
    expect(render('en', true, actions(0))).toBe(`<div class="qrow__actions">${original('View original')}`
      + '<span class="qrow__confirm" role="alert">Delete this quote and its file?</span>'
      + '<button type="button" class="qbtn qbtn--danger">Delete it</button><button type="button" class="qbtn">Cancel</button></div>')
    expect(render('es', true, actions(0))).toBe(`<div class="qrow__actions">${original('Ver original')}`
      + '<span class="qrow__confirm" role="alert">¿Eliminar esta cotización y su archivo?</span>'
      + '<button type="button" class="qbtn qbtn--danger">Eliminarla</button><button type="button" class="qbtn">Cancelar</button></div>')
  })

  test('names how many options go with a quote that has them, in English and Spanish', () => {
    expect(render('en', true, actions(2))).toContain('<span class="qrow__confirm" role="alert">Delete this quote, its 2 options and its file?</span>')
    expect(render('es', true, actions(2))).toContain('<span class="qrow__confirm" role="alert">¿Eliminar esta cotización, sus 2 opciones y su archivo?</span>')
  })

  test('shows its Delete button, and no question, until Delete is chosen', () => {
    expect(render('en', false, actions(0))).toBe(`<div class="qrow__actions">${original('View original')}<button type="button" class="qbtn">Delete</button></div>`)
    expect(render('es', false, actions(0))).toBe(`<div class="qrow__actions">${original('Ver original')}<button type="button" class="qbtn">Eliminar</button></div>`)
  })
})

describe('a quote that could not be read (ConfirmDelete)', () => {
  const trash = (optionCount: number) => createElement(ConfirmDelete, { name: 'unreadable.pdf', optionCount, onDelete: noop })

  test('asks the same question with the same answers, in English and Spanish', () => {
    expect(render('en', true, trash(0))).toBe('<span class="qconfirm"><span class="qrow__confirm" role="alert">Delete this quote and its file?</span>'
      + '<button type="button" class="qbtn qbtn--danger">Delete it</button><button type="button" class="qbtn">Cancel</button></span>')
    expect(render('es', true, trash(0))).toBe('<span class="qconfirm"><span class="qrow__confirm" role="alert">¿Eliminar esta cotización y su archivo?</span>'
      + '<button type="button" class="qbtn qbtn--danger">Eliminarla</button><button type="button" class="qbtn">Cancelar</button></span>')
  })

  test('names how many options go with a quote that has them, in English and Spanish', () => {
    expect(render('en', true, trash(3))).toContain('<span class="qrow__confirm" role="alert">Delete this quote, its 3 options and its file?</span>')
    expect(render('es', true, trash(3))).toContain('<span class="qrow__confirm" role="alert">¿Eliminar esta cotización, sus 3 opciones y su archivo?</span>')
  })

  test('shows its trash button, named for the file, until it is chosen', () => {
    expect(render('en', false, trash(0))).toMatch(/^<button type="button" class="qicon" aria-label="Delete unreadable\.pdf">/)
    expect(render('es', false, trash(0))).toMatch(/^<button type="button" class="qicon" aria-label="Eliminar unreadable\.pdf">/)
  })
})

describe('the project card look', () => {
  const card = (question: string, yes: string) => createElement(InlineConfirm, { look: 'card', question, yes, onYes: noop, onCancel: noop })

  test('keeps the panel the project card had: the question above its two answers, Cancel in the page language', () => {
    expect(render('en', true, card('Delete “Home”? This can’t be undone.', 'Delete project'))).toBe('<div class="pcard__confirm">'
      + '<p class="pcard__ask" role="alert">Delete “Home”? This can’t be undone.</p><div class="pcard__answers">'
      + '<button type="button" class="qbtn qbtn--danger">Delete project</button><button type="button" class="qbtn">Cancel</button></div></div>')
    expect(render('es', true, card('¿Eliminar “Casa”? No se puede deshacer.', 'Eliminar proyecto'))).toBe('<div class="pcard__confirm">'
      + '<p class="pcard__ask" role="alert">¿Eliminar “Casa”? No se puede deshacer.</p><div class="pcard__answers">'
      + '<button type="button" class="qbtn qbtn--danger">Eliminar proyecto</button><button type="button" class="qbtn">Cancelar</button></div></div>')
  })
})
