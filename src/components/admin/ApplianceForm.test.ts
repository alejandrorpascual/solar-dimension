import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { APPLIANCE_SEED } from '../../lib/catalog-snapshot'
import { ApplianceForm } from './ApplianceForm'

/** The save is a server function; a static render never submits, so it is stood in for. */
vi.mock('../../server/admin-catalog', () => ({ adminSaveAppliance: vi.fn() }))

const airConditioner = APPLIANCE_SEED.find((r) => r.category === 'Air conditioning')

/** The visible text of every option in the select whose label reads `label`, in order. */
function optionsOf(html: string, label: string): string[] {
  const field = new RegExp(`<span[^>]*>${label}</span><select[^>]*>(.*?)</select>`).exec(html)?.[1] ?? ''
  return [...field.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(([, text = '']) => text)
}

const renderForm = () => renderToStaticMarkup(createElement(ApplianceForm, {
  initial: airConditioner!, existingIds: new Set<string>(), onSaved: () => {}, onCancel: () => {},
}))

/** The class attribute of the button whose text is `text`. */
const buttonClass = (html: string, text: string) => new RegExp(`<button[^>]*class="([^"]*)"[^>]*>${text}</button>`).exec(html)?.[1]

test('the Compressor dropdown names its empty option "Not set", not a lone dash a screen reader skips', () => {
  expect(airConditioner).toBeDefined()
  expect(optionsOf(renderForm(), 'Compressor')).toEqual(['Not set', 'inverter', 'conventional'])
})

test('Save is the app\'s primary button and Cancel its quiet one', () => {
  const html = renderForm()
  expect(buttonClass(html, 'Save')).toBe('btn btn--primary')
  expect(buttonClass(html, 'Cancel')).toBe('btn btn--quiet')
})

test('every field is the app\'s field: a .field label around an .in control, with the edge and focus ring that brings', () => {
  const html = renderForm()
  const controls = [...html.matchAll(/<(input|select)\b[^>]*>/g)].map(([tag]) => tag)
  expect(controls.length).toBeGreaterThan(0)
  for (const tag of controls) expect(tag).toMatch(/class="in"/)
  expect(html).not.toMatch(/admin__field/)
  expect(html).toMatch(/<label class="field"><span class="lab">Name \(EN\)<\/span>/)
})

test('a form warning is the app\'s .warn box, not colored text of its own', () => {
  // 6000 W is over the 5 kW one-appliance check, so the form warns before Save.
  const heavy = { ...airConditioner!, watts: 6000, surge: 6000 }
  const html = renderToStaticMarkup(createElement(ApplianceForm, {
    initial: heavy, existingIds: new Set<string>(), onSaved: () => {}, onCancel: () => {},
  }))
  expect(html).toMatch(/<p class="warn admin__warn">Over 5 kW: check this is one appliance, not a whole circuit\.<\/p>/)
})
