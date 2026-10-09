import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { csvFor } from './kit-csv'
import { buildParts } from './kit-parts'
import { compute } from './sizing'
import { DEFAULT_QTY } from './store'

const en = getDictionary('en')
const es = getDictionary('es')

describe('csvFor', () => {
  const result = compute({ qty: { ...DEFAULT_QTY, barrier: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)

  test('writes the schedule by kind with an average column, then the parts', () => {
    const lines = csvFor(result, buildParts(result, en, 'en'), { appliances: true, parts: true }, en).slice(1).split('\r\n')
    expect(lines[0]).toBe('Appliance,Kind,Quantity,Each (W),Running (W),Average (W),Wh over 10 h')
    expect(lines.slice(1, 4)).toEqual(['LED lighting (10 bulbs),Always on,1,90,90,90,900', '"TV, 55-inch LED",Always on,1,120,120,120,1200', 'Wi-Fi router + modem,Always on,1,20,20,20,200'])
    expect(lines).toContain('Refrigerator,Cycles on and off,1,150,150,53,525')
    expect(lines).toContain('Parking barrier,Short bursts,1,150,150,5,50')
    expect(lines).toContain('Part,Specification,Note,Quantity')
    expect(lines.some((l) => l.startsWith('Fuse,100 A class T'))).toBe(true)
  })

  test('translates the kinds and headers', () => {
    const csv = csvFor(result, [], { appliances: true, parts: false }, es)
    expect(csv).toContain('Aparato,Tipo,Cantidad,C/u (W),En marcha (W),Promedio (W),Wh en 10 h')
    expect(csv).toContain('Refrigerador,Encienden y apagan,1,150,150,53,525')
  })

  test('drops the blocks that are switched off', () => {
    expect(csvFor(result, buildParts(result, en, 'en'), { appliances: false, parts: true }, en)).not.toContain('Refrigerator')
  })
})
