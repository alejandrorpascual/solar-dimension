import { describe, expect, test } from 'vitest'
import { buildCsv, csvCell, exportFileName, type CsvInput } from './export-csv'

const input = (include: CsvInput['include']): CsvInput => ({
  headers: { appliances: ['Appliance', 'Kind', 'Qty', 'Each (W)', 'Running (W)', 'Average (W)', 'Wh over 10 h'], parts: ['Part', 'Specification', 'Note', 'Qty'] },
  appliances: [{ name: 'Refrigerator', kind: 'Cycles on and off', qty: 1, eachW: 150, runningW: 150, averageW: 53, wh: 525 }],
  parts: [{ name: 'Fuse', spec: '80 A class T', note: 'Inline, close to the bank', qty: '1' }],
  include,
})

describe('csvCell', () => {
  test('leaves plain values alone', () => {
    expect(csvCell('Fuse')).toBe('Fuse')
    expect(csvCell(1515)).toBe('1515')
  })

  test('neutralises text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csvCell('+1 pump')).toBe("'+1 pump")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tTab')).toBe("'\tTab")
    expect(csvCell(-5)).toBe('-5')
  })

  test('quotes commas, quotes and line breaks, doubling inner quotes', () => {
    expect(csvCell('TV, 55"')).toBe('"TV, 55"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
})

describe('buildCsv', () => {
  test('writes the appliance block, a blank line, then the parts block, with a BOM for Excel', () => {
    const csv = buildCsv(input({ appliances: true, parts: true }))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Appliance,Kind,Qty,Each (W),Running (W),Average (W),Wh over 10 h',
      'Refrigerator,Cycles on and off,1,150,150,53,525',
      '',
      'Part,Specification,Note,Qty',
      'Fuse,80 A class T,"Inline, close to the bank",1',
    ])
  })

  test('drops a block that is switched off', () => {
    const partsOnly = buildCsv(input({ appliances: false, parts: true }))
    expect(partsOnly).not.toContain('Refrigerator')
    expect(partsOnly.slice(1).startsWith('Part,')).toBe(true)
    expect(buildCsv(input({ appliances: false, parts: false }))).toBe('﻿')
  })
})

describe('exportFileName', () => {
  test('keeps letters, digits, dashes and underscores, and turns spaces into dashes', () => {
    expect(exportFileName('Casa, playa!', 'pdf')).toBe('Casa-playa-kit.pdf')
    expect(exportFileName('  Home  office_2 ', 'csv')).toBe('Home-office_2-kit.csv')
    expect(exportFileName('Cabaña Ñuñoa', 'png')).toBe('Cabaña-Ñuñoa-kit.png')
  })

  test('falls back to plain "kit" when nothing usable is left', () => {
    expect(exportFileName('***', 'pdf')).toBe('kit.pdf')
  })
})
