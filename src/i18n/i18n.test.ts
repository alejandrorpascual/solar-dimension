import { describe, expect, test } from 'vitest'
import { CATEGORIES } from '../lib/catalog'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { en } from './en'
import { es } from './es'
import { applianceName, applianceNote, batteryCount, getDictionary, isLocale, resolveLocale, tr, trq } from './index'

describe('dictionaries', () => {
  test('es has every ui key that en has, and nothing extra', () => {
    expect(Object.keys(es.ui).sort()).toEqual(Object.keys(en.ui).sort())
  })
  test('every catalog category is translated in both languages', () => {
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
  test('the engineering-check warnings render their figures in both languages', () => {
    const p = { surgeW: 9400, seconds: 3, ratedW: 7500, inverterW: 5000, needA: 463, maxA: 540, strings: 9, unitLabel: '12 V 200 Ah AGM', fuseA: 200, surgeA: 309, shortCircuitA: 21600, aicA: 20000, dropPct: 12.5, ambientC: 90 }
    for (const d of [en, es]) {
      expect(d.warnings.surgeDuration(p)).toContain('9,400')
      expect(d.warnings.bankDischarge(p)).toContain('463')
      expect(d.warnings.bankDischarge(p)).toContain('12 V 200 Ah AGM')
      expect(d.warnings.bankPeak(p)).toContain('540')
      expect(d.warnings.fuseAboveBank(p)).toContain('200 A')
      expect(d.warnings.fuseAboveCable({ ...p, count: 6, maxA: 173 })).toContain('173')
      expect(d.warnings.fuseSurge(p)).toContain('309')
      expect(d.warnings.fuseInterrupt(p)).toContain('21,600')
      expect(d.warnings.startupDrop(p)).toContain('12.5%')
      expect(d.warnings.cableAmbient(p)).toContain('90 °C')
    }
  })
  test('es has every kind and parallel note that en has', () => {
    expect(Object.keys(es.kinds).sort()).toEqual(Object.keys(en.kinds).sort())
    expect(Object.keys(es.parallelNotes).sort()).toEqual(Object.keys(en.parallelNotes).sort())
    expect(Object.keys(es.parts).sort()).toEqual(Object.keys(en.parts).sort())
  })
  test('highCurrent ends the sentence when there is no higher voltage to suggest', () => {
    const p = { amps: 463, volts: 48, nextVolts: null }
    for (const d of [en, es]) {
      const text = d.warnings.highCurrent(p)
      expect(text.endsWith('.')).toBe(true)
      expect(text).not.toContain('null')
    }
  })
  test('es has every requester key that en has, and nothing extra', () => {
    expect(Object.keys(es.requester).sort()).toEqual(Object.keys(en.requester).sort())
  })
  test('every key the requester model and form use has copy in both languages', () => {
    const keys = [
      'cedula', 'rif', 'ein', 'idNumber', 'taxId', 'printCedula', 'printRif', 'printEin', 'printIdNumber', 'printTaxId',
      'prefixCedula', 'prefixRif', 'nameCompany', 'namePerson', 'contact', 'phone', 'email', 'address',
      'countryVE', 'countryUS', 'countryOTHER', 'phonePhVE', 'phonePhUS', 'phonePhOTHER', 'person', 'company',
      'errName', 'errCedula', 'errRif', 'errEin', 'errEmail',
    ] as const
    for (const d of [en, es]) for (const k of keys) expect(d.requester[k]).toBeTruthy()
  })
  test('the privacy page names the requester details in both languages', () => {
    expect(en.privacy.sections[0]?.body).toContain('client details for the spec sheet')
    expect(es.privacy.sections[0]?.body).toContain('datos del solicitante para la ficha')
  })
  test('the roof warning names what fits and what is needed in both languages', () => {
    expect(en.warnings.roofLimited({ fit: 6, need: 10 })).toContain('6')
    expect(en.warnings.roofLimited({ fit: 6, need: 10 })).toContain('10')
    expect(es.warnings.roofLimited({ fit: 6, need: 10 })).toContain('caben 6')
  })
  test('the undersized-cable warning names each cable row, its gauge and both currents in both languages', () => {
    const p = { gauge: '4/0 AWG', maxA: 172, needA: 174 }
    expect(en.warnings.cableUndersized({ ...p, conductor: 'mainCable' })).toContain('4/0 AWG for the main cable carries only 172 A')
    expect(en.warnings.cableUndersized({ ...p, conductor: 'interconnects' })).toContain('for the interconnects')
    expect(en.warnings.cableUndersized({ ...p, conductor: 'stringLeads' })).toContain('under its 174 A design current')
    expect(es.warnings.cableUndersized({ ...p, conductor: 'mainCable' })).toContain('El 4/0 AWG para el cable principal solo soporta 172 A')
    expect(es.warnings.cableUndersized({ ...p, conductor: 'interconnects' })).toContain('para las interconexiones')
    expect(es.warnings.cableUndersized({ ...p, conductor: 'stringLeads' })).toContain('para los cables de rama')
  })
  test('every part the kit can list has a name in both languages', () => {
    const keys = ['inverter', 'batteries', 'mainCable', 'interconnects', 'stringLeads', 'fuse', 'stringFuses', 'solarPanels', 'chargeController', 'pvCable', 'pvDisconnect', 'mounting'] as const
    for (const d of [en, es]) for (const k of keys) expect(d.parts[k]).toBeTruthy()
  })
  test('the four steps are named in both languages', () => {
    expect(en.ui.step3).toBe('Solar panels')
    expect(en.ui.step4).toBe('Your kit')
    expect(es.ui.step4).toBe('Tu kit')
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
    expect(tr(en, 'stepOf', { n: 2 })).toBe('Step 2 of 4')
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

test('applianceName reads the item labels in the active language and keeps custom names', () => {
  const fridge = CATALOG_SNAPSHOT.find((a) => a.id === 'fridge')!
  expect(applianceName(getDictionary('es'), fridge)).toBe('Refrigerador')
  expect(applianceName(getDictionary('en'), fridge)).toBe('Refrigerator')
  expect(applianceName(getDictionary('es'), { id: 'custom1', name: 'Bomba', isCustom: true })).toBe('Bomba')
  expect(applianceName(getDictionary('es'), { id: 'unknown', name: 'Fallback' })).toBe('Fallback')
})

test('applianceNote reads the item labels and keeps custom notes', () => {
  const fridge = CATALOG_SNAPSHOT.find((a) => a.id === 'fridge')!
  expect(applianceNote(getDictionary('es'), fridge)).toBe('El compresor trabaja ~35% de cada hora')
  expect(applianceNote(getDictionary('es'), { id: 'custom1', note: 'Custom · 230 V × 4.5 A', isCustom: true })).toBe('Custom · 230 V × 4.5 A')
  expect(applianceNote(getDictionary('es'), { id: 'unknown', note: 'Fallback' })).toBe('Fallback')
})

test('the missing-appliances warning agrees in number in both languages', () => {
  expect(en.warnings.missingAppliances({ count: 1 })).toContain('1 appliance in this project')
  expect(en.warnings.missingAppliances({ count: 3 })).toContain('3 appliances')
  expect(es.warnings.missingAppliances({ count: 1 })).toContain('No se pudo cargar 1 aparato')
  expect(es.warnings.missingAppliances({ count: 3 })).toContain('No se pudieron cargar 3 aparatos')
})

test('dictionaries no longer carry appliance names', () => {
  expect('appliances' in getDictionary('en')).toBe(false)
})

describe.each(['privacy', 'terms'] as const)('%s page', (page) => {
  test('both languages have the same sections, each with a heading and a body', () => {
    expect(es[page].sections).toHaveLength(en[page].sections.length)
    for (const d of [en, es]) {
      for (const s of d[page].sections) {
        expect(s.heading.trim()).not.toBe('')
        expect(s.body.trim()).not.toBe('')
      }
    }
  })
})

describe('quote dictionaries', () => {
  test('es has every quote key en has, and nothing extra', () => {
    expect(Object.keys(es.quotes).sort()).toEqual(Object.keys(en.quotes).sort())
  })
  test('every item has a name, an inline phrase and a short label in both languages', () => {
    for (const d of [en, es]) {
      for (const map of [d.quoteItems, d.quoteItemsInline, d.quoteItemsShort, d.quoteItemsList]) {
        expect(Object.keys(map).sort()).toEqual(['battery', 'cables', 'charger', 'fuse', 'installation', 'inverter', 'warranty', 'wifi'])
      }
    }
  })
  test('trq fills placeholders', () => {
    expect(trq(en, 'trayReading', { total: 4 })).toBe('Comparing 4 quotes')
    expect(trq(es, 'trayReading', { total: 4 })).toBe('Comparando 4 cotizaciones')
  })
  test('no quote string promises an email', () => {
    for (const d of [en, es]) expect(Object.values(d.quotes).join(' ')).not.toMatch(/e-?mail|correo/i)
  })
})
