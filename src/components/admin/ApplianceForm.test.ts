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
  const field = new RegExp(`<span>${label}</span><select[^>]*>(.*?)</select>`).exec(html)?.[1] ?? ''
  return [...field.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(([, text = '']) => text)
}

test('the Compressor dropdown names its empty option "Not set", not a lone dash a screen reader skips', () => {
  expect(airConditioner).toBeDefined()
  const html = renderToStaticMarkup(createElement(ApplianceForm, {
    initial: airConditioner!, existingIds: new Set<string>(), onSaved: () => {}, onCancel: () => {},
  }))
  expect(optionsOf(html, 'Compressor')).toEqual(['Not set', 'inverter', 'conventional'])
})
