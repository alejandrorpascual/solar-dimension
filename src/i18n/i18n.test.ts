import { describe, expect, test } from 'vitest'
import { APPLIANCES, CATEGORIES } from '../lib/catalog'
import { en } from './en'
import { es } from './es'
import { applianceName, applianceNote, batteryCount, getDictionary, isLocale, resolveLocale, tr } from './index'

describe('dictionaries', () => {
  test('es has every ui key that en has, and nothing extra', () => {
    expect(Object.keys(es.ui).sort()).toEqual(Object.keys(en.ui).sort())
  })
  test('every catalog appliance and category is translated in both languages', () => {
    for (const a of APPLIANCES) {
      expect(en.appliances[a.id]?.name, a.id).toBeTruthy()
      expect(es.appliances[a.id]?.name, a.id).toBeTruthy()
    }
    for (const c of [...CATEGORIES, 'All'] as const) {
      expect(en.categories[c]).toBeTruthy()
      expect(es.categories[c]).toBeTruthy()
    }
  })
  test('warnings render with params in both languages', () => {
    const p = { inverterW: 5000, voltsList: '24 / 36 / 48', amps: 463, volts: 12, nextVolts: 24, strings: 7, itemName: 'Window AC', sharePct: 54 }
    for (const d of [en, es]) {
      expect(d.warnings.inverterVoltage(p)).toContain('24 / 36 / 48')
      expect(d.warnings.highCurrent(p)).toContain('463')
      expect(d.warnings.parallelStrings(p)).toContain('7')
      expect(d.warnings.dominantLoad(p)).toContain('54')
    }
  })
  test('highCurrent ends the sentence when there is no higher voltage to suggest', () => {
    const p = { amps: 463, volts: 48, nextVolts: null }
    for (const d of [en, es]) {
      const text = d.warnings.highCurrent(p)
      expect(text.endsWith('.')).toBe(true)
      expect(text).not.toContain('null')
    }
  })
})

describe('batteryCount', () => {
  test('uses the singular for one battery and the plural otherwise, in both languages', () => {
    expect(batteryCount(en, 1)).toBe('1 battery')
    expect(batteryCount(en, 5)).toBe('5 batteries')
    expect(batteryCount(es, 1)).toBe('1 batería')
    expect(batteryCount(es, 2)).toBe('2 baterías')
  })
})

describe('isLocale', () => {
  test('accepts only known locale strings', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('es')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(42)).toBe(false)
    expect(isLocale(null)).toBe(false)
  })
})

describe('tr', () => {
  test('replaces placeholders and blanks missing params', () => {
    expect(tr(en, 'stepOf', { n: 2 })).toBe('Step 2 of 3')
    expect(tr(es, 'kitFor', { name: 'Casa' })).toBe('Kit para Casa')
    expect(tr(en, 'kitFor')).toBe('Kit for ')
    expect(tr(en, 'back')).toBe('Back')
  })
})

describe('resolveLocale', () => {
  test('prefers the cookie, then Accept-Language, then en', () => {
    expect(resolveLocale({ cookie: 'lang=es', acceptLanguage: 'en-US' })).toBe('es')
    expect(resolveLocale({ cookie: 'a=1; lang=en', acceptLanguage: 'es-MX' })).toBe('en')
    expect(resolveLocale({ cookie: null, acceptLanguage: 'es-419,es;q=0.9' })).toBe('es')
    expect(resolveLocale({ cookie: 'lang=fr', acceptLanguage: 'fr-FR' })).toBe('en')
    expect(resolveLocale({})).toBe('en')
  })

  test('walks the whole device language list by preference, not just the first entry', () => {
    expect(resolveLocale({ acceptLanguage: 'pt-BR,pt;q=0.9,es;q=0.8,en;q=0.7' })).toBe('es')
    expect(resolveLocale({ acceptLanguage: 'fr-FR,fr;q=0.9,en-GB;q=0.8' })).toBe('en')
    expect(resolveLocale({ acceptLanguage: 'en;q=0.3, es;q=0.9' })).toBe('es')
    expect(resolveLocale({ acceptLanguage: 'de-DE, *;q=0.5' })).toBe('en')
    expect(resolveLocale({ acceptLanguage: 'es;q=0, en;q=0.5' })).toBe('en')
    expect(resolveLocale({ acceptLanguage: ' ES-ar ' })).toBe('es')
  })
})

test('applianceName translates catalog items and keeps custom names', () => {
  const t = getDictionary('es')
  expect(applianceName(t, { id: 'fridge', name: 'Refrigerator' })).toBe('Refrigerador')
  expect(applianceName(t, { id: 'custom1', name: 'Bomba', isCustom: true })).toBe('Bomba')
  expect(applianceName(t, { id: 'unknown', name: 'Fallback' })).toBe('Fallback')
})

test('applianceNote translates catalog notes and keeps custom notes', () => {
  const t = getDictionary('es')
  expect(applianceNote(t, { id: 'fridge', note: 'Compressor cycles ~35% of each hour' })).toBe('El compresor trabaja ~35% de cada hora')
  expect(applianceNote(t, { id: 'custom1', note: 'Custom · 230 V × 4.5 A', isCustom: true })).toBe('Custom · 230 V × 4.5 A')
  expect(applianceNote(t, { id: 'unknown', note: 'Fallback' })).toBe('Fallback')
})

describe('privacy page', () => {
  test('both languages have the same sections, each with a heading and a body', () => {
    expect(es.privacy.sections).toHaveLength(en.privacy.sections.length)
    for (const d of [en, es]) {
      for (const s of d.privacy.sections) {
        expect(s.heading.trim()).not.toBe('')
        expect(s.body.trim()).not.toBe('')
      }
    }
  })
})
