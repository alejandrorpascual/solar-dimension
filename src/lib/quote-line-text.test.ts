import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { extraction, line } from './quote-fixtures'
import { lineRows } from './quote-line-text'
import { withOptionDefaults, type StoredExtraction } from './quote-schema'

const read = extraction([
  line('inverter', 1890, { description: 'Inversor híbrido 12 kW', unitPrice: 1890 }),
  line('battery', 2760, { description: 'Batería LiFePO4 5.12 kWh', qty: 8, unitPrice: 345 }),
  line('fuse', 90, { description: 'Fusible clase T 225 A', qty: 2, unitPrice: 45.5 }),
  line('labor', 1495, { description: 'Instalación y puesta en marcha' }),
])

describe('the lines a reading lists when its checks are open', () => {
  test('every line, in the order read, with its quantity, unit price and line total', () => {
    expect(lineRows(en, read, null)).toEqual([
      { description: 'Inversor híbrido 12 kW', qty: '1', unitPrice: '$1,890', lineTotal: '$1,890' },
      { description: 'Batería LiFePO4 5.12 kWh', qty: '8', unitPrice: '$345', lineTotal: '$2,760' },
      { description: 'Fusible clase T 225 A', qty: '2', unitPrice: '$45.50', lineTotal: '$90' },
      { description: 'Instalación y puesta en marcha', qty: '1', unitPrice: '—', lineTotal: '$1,495' },
    ])
  })

  test('an optional line says so, in English and Spanish', () => {
    const x = extraction([line('inverter', 1890), line('monitoring', 120, { description: 'WiFi opcional', optional: true })])
    expect(lineRows(en, x, null)[1]!.description).toBe('WiFi opcional (optional)')
    expect(lineRows(es, x, null)[1]!.description).toBe('WiFi opcional (opcional)')
  })

  test('a reading in a currency that is no ISO code still lists its amounts', () => {
    const x = extraction([line('inverter', 1890, { unitPrice: 945, qty: 2 })], { currency: 'RD$' })
    expect(lineRows(en, x, null)).toEqual([{ description: 'inverter', qty: '2', unitPrice: '945 RD$', lineTotal: '1,890 RD$' }])
  })

  test("an option's card lists its own lines and the shared ones, not another option's", () => {
    const x = extraction(
      [
        line('inverter', 1890, { description: 'Inversor 10 kW', option: 'o1' }),
        line('inverter', 2400, { description: 'Inversor 12 kW', option: 'o2' }),
        line('labor', 900, { description: 'Instalación' }),
      ],
      { options: [{ id: 'o1', label: '10 kW', total: null, tax: null }, { id: 'o2', label: '12 kW', total: null, tax: null }] },
    )
    expect(lineRows(en, x, 'o2').map((r) => r.description)).toEqual(['Inversor 12 kW', 'Instalación'])
    expect(lineRows(en, x, null).map((r) => r.description)).toEqual(['Inversor 10 kW', 'Inversor 12 kW', 'Instalación'])
  })

  test('a reading stored before options existed lists every line', () => {
    const { options: _options, ...rest } = read
    const stored: StoredExtraction = { ...rest, lines: read.lines.map(({ option: _option, ...l }) => l) }
    expect(lineRows(en, withOptionDefaults(stored), null).map((r) => r.lineTotal)).toEqual(['$1,890', '$2,760', '$90', '$1,495'])
  })
})
