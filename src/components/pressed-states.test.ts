import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { computeProject } from '../lib/project-summary'
import { currentProject, initialStore, patchCurrent } from '../lib/store'
import { ApplianceGrid } from './ApplianceGrid'
import { BackupWindow } from './BackupWindow'
import { CustomApplianceForm } from './CustomApplianceForm'

/** The root route's data is not there outside the app, so the hooks that read it are stood in for. */
vi.mock('../hooks/useLocale', async () => {
  const { getDictionary } = await import('../i18n')
  return { useLocale: () => ({ locale: 'en', t: getDictionary('en') }) }
})
vi.mock('../hooks/useCatalog', async () => {
  const { CATALOG_SNAPSHOT } = await import('../lib/catalog-snapshot')
  return { useCatalog: () => CATALOG_SNAPSHOT }
})

interface Button { text: string; pressed: string | null }

/** Every button the element renders: its text, tags out, and its aria-pressed, if any. */
function buttonsOf(element: ReactElement): Button[] {
  const html = renderToStaticMarkup(element)
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs = '', inner = '']) => ({
    text: inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    pressed: /aria-pressed="(\w+)"/.exec(attrs)?.[1] ?? null,
  }))
}

/** The aria-pressed of the first button that reads each label (an option may add a hint after it), or 'no button'. */
const pressedOf = (buttons: Button[], labels: readonly string[]) =>
  labels.map((label) => {
    const button = buttons.find((b) => b.text === label || b.text.startsWith(`${label} `))
    return button ? button.pressed : 'no button'
  })

/** A group with `selected` pressed and every other option not. */
const onlyPressed = (labels: readonly string[], selected: string) => labels.map((label) => String(label === selected))

const HOUR_PRESETS = ['4 h', '8 h', '10 h', '12 h', '24 h', '48 h']
const VOLTAGES = ['12 V', '24 V', '36 V', '48 V']
const CHEMISTRIES = ['LiFePO₄ lithium', 'AGM lead-acid']
const CATEGORIES = ['All', 'Kitchen', 'Living', 'Climate', 'Air conditioning', 'Work', 'Utility', 'Security', 'Personal', 'Custom']
const MODES = ['Watts', 'Volts × amps']

test('step 2 presses the hour preset, voltage and chemistry the project has, and no other option', () => {
  const store = patchCurrent(initialStore(), { hours: 12, volts: 24, chemistry: 'agm' })
  const result = computeProject(currentProject(store), CATALOG_SNAPSHOT)
  const buttons = buttonsOf(createElement(BackupWindow, { store, commit: () => {}, result }))
  expect(pressedOf(buttons, HOUR_PRESETS)).toEqual(onlyPressed(HOUR_PRESETS, '12 h'))
  expect(pressedOf(buttons, VOLTAGES)).toEqual(onlyPressed(VOLTAGES, '24 V'))
  expect(pressedOf(buttons, CHEMISTRIES)).toEqual(onlyPressed(CHEMISTRIES, 'AGM lead-acid'))
})

test('step 1 presses the category filter in effect, All at first, and no other', () => {
  const buttons = buttonsOf(createElement(ApplianceGrid, { store: initialStore(), commit: () => {} }))
  expect(pressedOf(buttons, CATEGORIES)).toEqual(onlyPressed(CATEGORIES, 'All'))
})

test('the custom appliance form presses the mode it is in, watts at first, and not the other', () => {
  const buttons = buttonsOf(createElement(CustomApplianceForm, { store: initialStore(), commit: () => {} }))
  expect(pressedOf(buttons, MODES)).toEqual(onlyPressed(MODES, 'Watts'))
})
