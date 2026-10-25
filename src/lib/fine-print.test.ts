import { describe, expect, test, vi } from 'vitest'
import { getDictionary } from '../i18n'
import { fmtW } from '../i18n/format'
import { CHEMISTRIES, INVERTERS } from './catalog'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { finePrint } from './fine-print'
import { compute } from './sizing'
import { unitId } from './sizing/battery'

/** A battery unit picked by hand, so the test can read that unit's ratings from the catalog. */
const KITS = [
  { name: 'LiFePO₄', chemistry: 'lifepo4', volts: 48, batteryUnit: '48-100' },
  { name: 'AGM', chemistry: 'agm', volts: 12, batteryUnit: '12-200' },
] as const

const DOD_PCT = 85

describe.each(['en', 'es'] as const)('finePrint (%s)', (locale) => {
  const t = getDictionary(locale)
  const es = locale === 'es'

  test.each(KITS)('a $name kit lists the battery and inverter ratings it was sized with, as the catalog states them', ({ chemistry, volts, batteryUnit }) => {
    const r = compute({ qty: { fridge: 1, lights: 1 }, hours: 8, volts, chemistry, batteryUnit }, CATALOG_SNAPSHOT)
    const chem = CHEMISTRIES[chemistry]
    const unit = chem.units.find((u) => unitId(u.v, u.ah) === batteryUnit)!
    const inverter = INVERTERS.find((i) => i.w === r.inverter.unitW)!
    const text = finePrint(t, r, DOD_PCT, locale)
    expect(text).toContain(es
      ? `${unit.maxContinuousA} A continuos y ${unit.peakA} A de corriente pico durante ${unit.peakSeconds} s`
      : `${unit.maxContinuousA} A continuous and ${unit.peakA} A peak current for ${unit.peakSeconds} s`)
    expect(text).toContain(es ? `como máximo ${unit.maxParallel} en paralelo` : `at most ${unit.maxParallel} in parallel`)
    expect(text).toContain(es ? `${chem.shortCircuitPerAh} A por Ah en cortocircuito` : `${chem.shortCircuitPerAh} A per Ah into a short`)
    expect(text).toContain(es
      ? `tiene una potencia pico de ${fmtW(inverter.surge, locale)} durante ${inverter.surgeSeconds} s`
      : `has a ${fmtW(inverter.surge, locale)} surge rating for ${inverter.surgeSeconds} s`)
  })

  test('says the inverter sizes are continuous watts, not VA, at room temperature, with the headroom for power factor and heat', () => {
    const r = compute({ qty: { fridge: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).toContain(es
      ? 'Los tamaños de inversor son vatios continuos, no VA, a temperatura ambiente; el margen de 25% cubre el factor de potencia y el calor.'
      : 'Inverter sizes are continuous watts, not VA, at room temperature; the 25% headroom covers power factor and heat.')
  })

  test('the inverter efficiency, the headroom and the watts per ton of cooling are the sizing constants', async () => {
    vi.resetModules()
    vi.doMock('./catalog', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./catalog')>()
      return { ...actual, SIZING: { ...actual.SIZING, INVERTER_EFF: 0.85, HEADROOM: 1.3, WATTS_PER_TON: 1200 } }
    })
    try {
      const { finePrint: withOtherConstants } = await import('./fine-print')
      const r = compute({ qty: { fridge: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
      const text = withOtherConstants(t, r, DOD_PCT, locale)
      expect(text).toContain(es ? 'Supone 85% de eficiencia del inversor, 30% de margen,' : 'Assumes 85% inverter efficiency, 30% inverter headroom,')
      expect(text).toContain(es ? '1,200 W por tonelada de refrigeración' : '1,200 W per ton of cooling')
      expect(text).toContain(es ? 'el margen de 30% cubre' : 'the 30% headroom covers')
    } finally {
      vi.doUnmock('./catalog')
      vi.resetModules()
    }
  })

  test('inverters in parallel give one unit\'s surge, the rating each of them is sized with', () => {
    const custom = [{ id: 'x', name: 'Load', watts: 15000, surge: 15000, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    const inverter = INVERTERS.find((i) => i.w === r.inverter.unitW)!
    expect(r.inverter.count).toBeGreaterThan(1)
    expect(finePrint(t, r, DOD_PCT, locale)).toContain(es
      ? `cada inversor de ${fmtW(inverter.w, locale)} tiene una potencia pico de ${fmtW(inverter.surge, locale)} durante ${inverter.surgeSeconds} s`
      : `each ${fmtW(inverter.w, locale)} inverter has a ${fmtW(inverter.surge, locale)} surge rating for ${inverter.surgeSeconds} s`)
  })

  test('a panel kit adds the solar assumptions after the ratings', () => {
    const r = compute({ qty: { fridge: 1, lights: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const text = finePrint(t, r, DOD_PCT, locale)
    const ratings = text.indexOf(es ? 'Valores supuestos' : 'Assumed ratings')
    expect(ratings).toBeGreaterThan(0)
    expect(text.indexOf(es ? 'La parte solar supone paneles de 550 W' : 'Solar assumes 550 W panels')).toBeGreaterThan(ratings)
  })

  test('a kit with an AC states the duty it assumed on a typical day and on a hard day', () => {
    const r = compute({ qty: { ac1c: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).toContain(es
      ? 'El aire acondicionado funciona 50% de cada hora en un día típico y 100% en un día duro.'
      : 'Air conditioning runs 50% of each hour on a typical day and 100% on a hard day.')
  })

  test('ACs at different duties give the typical range, the changed duty included', () => {
    const r = compute({ qty: { ac1c: 1, ac15i: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4', dutyOverrides: { ac15i: 0.75 } }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).toContain(es ? 'funciona 50–75% de cada hora' : 'runs 50–75% of each hour')
  })

  test('a kit without an AC says nothing about AC duty', () => {
    const r = compute({ qty: { fridge: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).not.toContain(es ? 'aire acondicionado' : 'Air conditioning')
  })

  test('says every appliance counts in every hour of the window', () => {
    const r = compute({ qty: { micro: 1 }, hours: 24, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).toContain(es
      ? 'Cada aparato cuenta en todas las horas del respaldo.'
      : 'Every appliance counts in every hour of the window.')
  })

  test('a kit with nothing selected has no battery to list ratings for', () => {
    const r = compute({ qty: {}, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).not.toContain(es ? 'Valores supuestos' : 'Assumed ratings')
  })
})
