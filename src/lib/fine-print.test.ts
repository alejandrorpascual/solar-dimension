import { describe, expect, test } from 'vitest'
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
      ? `${unit.maxContinuousA} A continuos y ${unit.peakA} A pico durante ${unit.peakSeconds} s`
      : `${unit.maxContinuousA} A continuous and ${unit.peakA} A peak for ${unit.peakSeconds} s`)
    expect(text).toContain(es ? `como máximo ${unit.maxParallel} en paralelo` : `at most ${unit.maxParallel} in parallel`)
    expect(text).toContain(es ? `${chem.shortCircuitPerAh} A por Ah en cortocircuito` : `${chem.shortCircuitPerAh} A per Ah into a short`)
    expect(text).toContain(es
      ? `arranca hasta ${fmtW(inverter.surge, locale)} durante ${inverter.surgeSeconds} s`
      : `surges to ${fmtW(inverter.surge, locale)} for ${inverter.surgeSeconds} s`)
  })

  test('says the inverter sizes are continuous watts, not VA, at room temperature, with the headroom for power factor and heat', () => {
    const r = compute({ qty: { fridge: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).toContain(es
      ? 'Los tamaños de inversor son vatios continuos, no VA, a temperatura ambiente; el margen de 25% cubre el factor de potencia y el calor.'
      : 'Inverter sizes are continuous watts, not VA, at room temperature; the 25% headroom covers power factor and heat.')
  })

  test('inverters in parallel give one unit\'s surge, the rating each of them is sized with', () => {
    const custom = [{ id: 'x', name: 'Load', watts: 15000, surge: 15000, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    const inverter = INVERTERS.find((i) => i.w === r.inverter.unitW)!
    expect(r.inverter.count).toBeGreaterThan(1)
    expect(finePrint(t, r, DOD_PCT, locale)).toContain(es
      ? `cada inversor de ${fmtW(inverter.w, locale)} arranca hasta ${fmtW(inverter.surge, locale)} durante ${inverter.surgeSeconds} s`
      : `each ${fmtW(inverter.w, locale)} inverter surges to ${fmtW(inverter.surge, locale)} for ${inverter.surgeSeconds} s`)
  })

  test('a panel kit adds the solar assumptions after the ratings', () => {
    const r = compute({ qty: { fridge: 1, lights: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const text = finePrint(t, r, DOD_PCT, locale)
    const ratings = text.indexOf(es ? 'Valores supuestos' : 'Assumed ratings')
    expect(ratings).toBeGreaterThan(0)
    expect(text.indexOf(es ? 'La parte solar supone paneles de 550 W' : 'Solar assumes 550 W panels')).toBeGreaterThan(ratings)
  })

  test('a kit with nothing selected has no battery to list ratings for', () => {
    const r = compute({ qty: {}, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(finePrint(t, r, DOD_PCT, locale)).not.toContain(es ? 'Valores supuestos' : 'Assumed ratings')
  })
})
