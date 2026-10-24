import { describe, expect, test } from 'vitest'
import seedLeads from '../../scripts/product-search/seed-leads.json'
import { mergeProduct } from './product-merge'
import { NONE, SHEET, battery, inverter, stated, stating } from './product-fixtures'
import { productKey, type ProductInput } from './product-schema'
import { warnProducts } from './product-warnings'

/** The messages for one product sent alone, against the stored products given. */
const warn = (product: ProductInput, stored: readonly ProductInput[] = []) => warnProducts(stored, [product]).flatMap((w) => w.messages)
const level = (w: number, seconds: number, asWritten: string) => ({ w, seconds, asWritten, source: SHEET })

/** The messages for `incoming` sent over `stored`, the same product, with the product the merge would store (replace off). */
function warnOver(stored: ProductInput, incoming: ProductInput): string[] {
  const record = { ...stored, id: 'id-1', key: productKey(stored), origin: 'admin' as const, conflicts: [], retired: false }
  const { next } = mergeProduct(record, incoming, { replace: false, now: '2026-10-23T12:00:00.000Z' })
  return warnProducts([stored], [incoming], [next]).flatMap((w) => w.messages)
}

describe('warnProducts on the fixtures', () => {
  test('the inverter() and battery() fixtures give no warning, alone or together', () => {
    expect(warnProducts([], [inverter(), battery()])).toEqual([])
    expect(warnProducts([inverter()], [battery()])).toEqual([])
  })
})

describe('warnProducts on odd specs', () => {
  test('warns when kWh is more than 10% off volts × Ah, and not at 9%', () => {
    expect(warn(battery({ kWh: stated(6, '6kWh') }))).toEqual([
      '6 kWh is 17% off 51.2 V × 100 Ah = 5.12 kWh: check the energy, the voltage and the amp-hours.',
    ])
    expect(warn(battery({ kWh: stated(5.6, '5.6kWh') }))).toEqual([])
  })

  test('warns on a surge level below the continuous watts, and not on one equal to it', () => {
    expect(warn(inverter({ surges: [level(5000, 10, '5000W for 10 s')] }))).toEqual([
      'A surge of 5000 W is below the 6000 W continuous: check the surge levels.',
    ])
    expect(warn(inverter({ surges: [level(6000, 10, '6000W for 10 s')] }))).toEqual([])
  })

  test('warns on peak amps below the continuous amps, and not on a higher peak', () => {
    expect(warn(battery({ peakA: stated(80, 'Peak discharge 80A') }))).toEqual([
      'Peak 80 A is below the 100 A continuous: check the peak and continuous current.',
    ])
    expect(warn(battery({ peakA: stated(200, 'Peak discharge 200A') }))).toEqual([])
  })

  test('warns on nominal volts more than 15% from 12, 24, 36 or 48 V, counting 51.2 V as 48 V', () => {
    expect(warn(battery({ nominalV: stated(60, '60V'), kWh: stated(6, '6kWh') }))).toEqual([
      '60 V is more than 15% from 12, 24, 36 or 48 V: check the nominal voltage.',
    ])
    expect(warn(inverter({ batteryVolts: stated(30, '30 VDC') }))).toEqual([
      '30 V is more than 15% from 12, 24, 36 or 48 V: check the battery voltage.',
    ])
    for (const volts of [12.8, 25.6, 40, 51.2]) {
      expect(warn(inverter({ batteryVolts: stated(volts, `${volts} VDC`) }))).toEqual([])
    }
  })

  test('warns on a peak efficiency under 50%, and not at 50%', () => {
    expect(warn(inverter({ peakEfficiencyPct: stated(0.95, '0.95') }))).toEqual(['Peak efficiency 0.95% is under 50%: check it is a percent.'])
    expect(warn(inverter({ peakEfficiencyPct: stated(50, '50%') }))).toEqual([])
  })

  test('warns on continuous watts under 100, and not at 100', () => {
    expect(warn(inverter({ continuousW: stated(6, 'Rated power 6kW') }))).toEqual(['6 W continuous is under 100 W: check the power is in watts.'])
    expect(warn(inverter({ continuousW: stated(100, 'Rated power 100W'), surges: [] }))).toEqual([])
  })

  test('warns on a stated value whose digits are not in its words as written, whatever the separators', () => {
    expect(warn(inverter({ continuousW: stated(6000, 'Rated power 600W') }))).toEqual([
      'specs.continuousW 6000 is not in its words as written ("Rated power 600W"): check the digits.',
    ])
    expect(warn(inverter({ surges: [level(12000, 30, '12,000W for 3 seconds')] }))).toEqual([
      'specs.surges.0.seconds 30 is not in its words as written ("12,000W for 3 seconds"): check the digits.',
    ])
    expect(warn(battery({ kWh: stated(5.12, '5,12 kWh') }))).toEqual([])
  })

  test('warns once per foreign host on spec sources that are neither the maker page’s nor the datasheet’s host', () => {
    const shop = { value: 6000, source: 'https://shop.example/inverter', asWritten: '6000W' }
    const extra = { name: 'Weight', value: '20 kg', source: 'https://shop.example/inverter' }

    expect(warn({ ...inverter({ continuousW: shop }), extraSpecs: [extra] })).toEqual([
      "Source host shop.example (specs.continuousW, extraSpecs.Weight) is neither the maker page's nor the datasheet's: check the maker states the same.",
    ])
    expect(warn({ ...inverter({ continuousW: shop }), makerUrl: 'https://shop.example/' })).toEqual([])
  })
})

describe('warnProducts at the limits', () => {
  test('gives no warning at exactly 15% from a system voltage or 10% off volts × Ah, and warns just past them', () => {
    for (const volts of [10.2, 13.8, 20.4, 27.6, 55.2]) {
      expect(warn(inverter({ batteryVolts: stated(volts, `${volts} VDC`) })), `${volts} V`).toEqual([])
    }
    for (const kWh of [4.608, 5.632]) {
      expect(warn(battery({ kWh: stated(kWh, `${kWh}kWh`) })), `${kWh} kWh`).toEqual([])
    }

    expect(warn(inverter({ batteryVolts: stated(13.9, '13.9 VDC') }))).toEqual([
      '13.9 V is more than 15% from 12, 24, 36 or 48 V: check the battery voltage.',
    ])
    expect(warn(battery({ kWh: stated(4.6, '4.6kWh') }))).toEqual([
      '4.6 kWh is 10% off 51.2 V × 100 Ah = 5.12 kWh: check the energy, the voltage and the amp-hours.',
    ])
  })
})

describe('warnProducts on a product filled in over a stored one', () => {
  test('checks a kWh filled into a stored battery against its stored volts × Ah', () => {
    const stored = battery({ kWh: NONE })

    expect(warnOver(stored, stating(stored, { kWh: stated(6, '6kWh') }))).toEqual([
      '6 kWh is 17% off 51.2 V × 100 Ah = 5.12 kWh: check the energy, the voltage and the amp-hours.',
    ])
  })

  test('checks a peak amps or a surge level filled in below the stored continuous value', () => {
    const storedBattery = battery()
    const storedInverter = inverter({ surges: [] })

    expect(warnOver(storedBattery, stating(storedBattery, { peakA: stated(80, 'Peak discharge 80A') }))).toEqual([
      'Peak 80 A is below the 100 A continuous: check the peak and continuous current.',
    ])
    expect(warnOver(storedInverter, stating(storedInverter, { surges: [level(5000, 10, '5000W for 10 s')] }))).toEqual([
      'A surge of 5000 W is below the 6000 W continuous: check the surge levels.',
    ])
  })

  test('checks volts, Ah or a continuous value filled in against the stored values they are compared with', () => {
    const noVolts = battery({ nominalV: NONE, kWh: stated(6, '6kWh') })
    const noAh = battery({ ah: NONE, kWh: stated(6, '6kWh') })
    const noContinuousA = battery({ maxContinuousA: NONE, peakA: stated(80, 'Peak discharge 80A') })
    const noContinuousW = inverter({ continuousW: NONE, surges: [level(5000, 10, '5000W for 10 s')] })
    const kWhOff = '6 kWh is 17% off 51.2 V × 100 Ah = 5.12 kWh: check the energy, the voltage and the amp-hours.'

    expect(warnOver(noVolts, stating(noVolts, { nominalV: stated(51.2, 'Nominal Voltage 51.2V') }))).toEqual([kWhOff])
    expect(warnOver(noAh, stating(noAh, { ah: stated(100, '100Ah') }))).toEqual([kWhOff])
    expect(warnOver(noContinuousA, stating(noContinuousA, { maxContinuousA: stated(100, 'Max. continuous discharge 100A') }))).toEqual([
      'Peak 80 A is below the 100 A continuous: check the peak and continuous current.',
    ])
    expect(warnOver(noContinuousW, stating(noContinuousW, { continuousW: stated(6000, 'NOMINAL POWER OUTPUT 6000W') }))).toEqual([
      'A surge of 5000 W is below the 6000 W continuous: check the surge levels.',
    ])
  })

  test('gives no warning from stored values alone when the request states none of a check’s fields', () => {
    const oddBattery = battery({ kWh: stated(6, '6kWh'), peakA: stated(80, 'Peak discharge 80A') })
    const oddInverter = inverter({ surges: [level(5000, 10, '5000W for 10 s')] })

    expect(warnOver(oddBattery, stating(oddBattery, { warrantyYears: stated(10, '10-year warranty') }))).toEqual([])
    expect(warnOver(oddInverter, stating(oddInverter, { warrantyYears: stated(5, '5-YEAR WARRANTY') }))).toEqual([])
  })

  test('still checks the numbers as sent when the merge keeps the stored value aside as a conflict', () => {
    expect(warnOver(battery(), battery({ kWh: stated(6, '6kWh') }))).toEqual([
      '6 kWh is 17% off 51.2 V × 100 Ah = 5.12 kWh: check the energy, the voltage and the amp-hours.',
    ])
  })
})

describe('warnProducts on possible duplicates', () => {
  const stored = { ...inverter(), datasheetUrl: 'https://example.com/6000xp.pdf' }

  test('names a stored product of the same maker with the same datasheet, maker page or model start', () => {
    const named = ['Possible duplicate of the stored EG4 Electronics 6000XP (inverter:eg4:6000xp).']
    const page = 'https://example.com/eg4-page'

    expect(warn({ ...inverter(), model: 'XP6000', datasheetUrl: stored.datasheetUrl }, [stored])).toEqual(named)
    expect(warn({ ...inverter(), model: 'XP6000', makerUrl: page }, [{ ...stored, makerUrl: page }])).toEqual(named)
    expect(warn({ ...inverter(), brand: 'EG4', model: '6000XP v2' }, [stored])).toEqual(named)
  })

  test('does not name the product itself, another maker, a model sharing only 5 characters, or two missing maker pages', () => {
    expect(warn({ ...stored, datasheetUrl: SHEET }, [stored])).toEqual([])
    expect(warn({ ...inverter(), brand: 'Sol-Ark', model: '6000XP-2', datasheetUrl: stored.datasheetUrl }, [stored])).toEqual([])
    expect(warn({ ...inverter(), model: '6000X-mini' }, [stored])).toEqual([])
    expect(warn({ ...inverter(), model: 'XP6000', makerUrl: null }, [{ ...stored, makerUrl: null }])).toEqual([])
  })

  test('names another product in the same request, each one the other', () => {
    const a = { ...inverter(), model: 'SNA-US 12000' }
    const b = { ...inverter(), model: 'SNA-US 12K', datasheetUrl: 'https://example.com/other.pdf' }

    expect(warnProducts([], [a, b])).toEqual([
      { key: 'inverter:eg4:snaus12000', messages: ['Possible duplicate of EG4 Electronics SNA-US 12K (inverter:eg4:snaus12k) in this request.'] },
      { key: 'inverter:eg4:snaus12k', messages: ['Possible duplicate of EG4 Electronics SNA-US 12000 (inverter:eg4:snaus12000) in this request.'] },
    ])
  })

  test('in the seed leads, only the two LuxpowerTek SNA-US and the two Pytes V5 warn, each naming the other', () => {
    type Lead = { brand: string; model: string; productUrl: string; datasheetUrl: string | null }
    const asProduct = (base: ProductInput, lead: Lead): ProductInput =>
      ({ ...base, brand: lead.brand, model: lead.model, makerUrl: lead.productUrl, datasheetUrl: lead.datasheetUrl ?? SHEET })
    const leads = [
      ...seedLeads.inverters.map((lead: Lead) => asProduct(inverter(), lead)),
      ...seedLeads.batteries.map((lead: Lead) => asProduct(battery(), lead)),
    ]

    const duplicates = warnProducts([], leads)
      .map((w) => ({ key: w.key, messages: w.messages.filter((m) => m.startsWith('Possible duplicate')) }))
      .filter((w) => w.messages.length > 0)

    expect(duplicates).toEqual([
      { key: 'inverter:luxpowertek:snaus12000', messages: ['Possible duplicate of LuxpowerTek SNA-US 12K (inverter:luxpowertek:snaus12k) in this request.'] },
      { key: 'inverter:luxpowertek:snaus12k', messages: ['Possible duplicate of LuxpowerTek SNA-US 12000 (inverter:luxpowertek:snaus12000) in this request.'] },
      { key: 'battery:pytes:v5512v100ah', messages: ['Possible duplicate of Pytes V5 (battery:pytes:v5) in this request.'] },
      { key: 'battery:pytes:v5', messages: ['Possible duplicate of Pytes V5° 51.2V 100Ah (battery:pytes:v5512v100ah) in this request.'] },
    ])
  })
})
