import { describe, expect, test } from 'vitest'
import { buildCsv, csvCell, csvDelimiter, exportFileName, type CsvInput } from './export-csv'

const input = (include: CsvInput['include'], attention: CsvInput['attention'] = []): CsvInput => ({
  headers: { appliances: ['Appliance', 'Kind', 'Qty', 'Each (W)', 'Running (W)', 'Average (W)', 'Wh over 10 h'], parts: ['Part', 'Specification', 'Note', 'Qty'], attention: ['Needs attention', 'Note'] },
  attention,
  appliances: [{ name: 'Refrigerator', kind: 'Cycles on and off', qty: 1, eachW: 150, runningW: 150, averageW: 53, wh: 525 }],
  parts: [{ name: 'Fuse', spec: '80 A class T', note: 'Inline, close to the bank', qty: '1' }],
  include,
})

describe('csvDelimiter', () => {
  test('a semicolon where the browser locale writes decimals with a comma, else a comma', () => {
    expect(csvDelimiter('es-VE')).toBe(';')
    expect(csvDelimiter('es-ES')).toBe(';')
    expect(csvDelimiter('de-DE')).toBe(';')
    expect(csvDelimiter('en-US')).toBe(',')
    // Latin American Spanish as a whole writes "1.5", so Excel there splits on commas.
    expect(csvDelimiter('es-419')).toBe(',')
  })

  test('a locale it cannot read falls back to a comma', () => {
    expect(csvDelimiter('')).toBe(',')
    expect(csvDelimiter('not a locale!')).toBe(',')
  })
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

  test('with a semicolon delimiter it quotes a cell holding a semicolon and leaves a comma alone', () => {
    expect(csvCell('Bomba; pozo', ';')).toBe('"Bomba; pozo"')
    expect(csvCell('6 AWG, 30 cm', ';')).toBe('6 AWG, 30 cm')
    expect(csvCell('TV 55"', ';')).toBe('"TV 55"""')
  })
})

describe('buildCsv', () => {
  test('the failing checks and notes follow the parts when there are any, even with every block switched off', () => {
    const attention = [{ name: 'Cable', text: '333 A on the DC side at 12 V is hard to wire safely.' }, { name: 'Notes for the installer', text: 'Usually runs on 240 V, so plan for it' }]
    const lines = buildCsv(input({ appliances: false, parts: true }, attention)).slice(1).split('\r\n')
    expect(lines.slice(-4)).toEqual(['', 'Needs attention,Note', 'Cable,333 A on the DC side at 12 V is hard to wire safely.', 'Notes for the installer,"Usually runs on 240 V, so plan for it"'])
    expect(buildCsv(input({ appliances: false, parts: false }, attention)).slice(1).split('\r\n')).toHaveLength(3)
    expect(buildCsv(input({ appliances: true, parts: true }))).not.toContain('Needs attention')
  })

  test('a closing line goes under everything, the failing checks and notes included, as a block of its own', () => {
    const attention = [{ name: 'Cable', text: 'Hard to wire safely' }]
    const lines = buildCsv({ ...input({ appliances: false, parts: true }, attention), footer: 'An estimate, not a design.' }).slice(1).split('\r\n')
    expect(lines.slice(-4)).toEqual(['Needs attention,Note', 'Cable,Hard to wire safely', '', '"An estimate, not a design."'])
    expect(buildCsv({ ...input({ appliances: false, parts: false }), footer: 'Estimate' }).slice(1)).toBe('Estimate')
  })

  test.each([
    ['a quote', 'Say "estimate"', '"Say ""estimate"""'],
    ['a line break', 'An estimate\nNot a design', '"An estimate\nNot a design"'],
    ['an equals sign first', '=SUM(A1)', "'=SUM(A1)"],
    ['a plus first', '+1 estimate', "'+1 estimate"],
    ['a minus first', '-1 estimate', "'-1 estimate"],
    ['an at sign first', '@estimate', "'@estimate"],
    ['a tab first', '\testimate', "'\testimate"],
    ['a carriage return first', '\restimate', `"'\restimate"`],
  ])('a closing line with %s stays one cell of text, never a formula', (_, footer, cell) => {
    expect(buildCsv({ ...input({ appliances: false, parts: false }), footer }).slice(1)).toBe(cell)
  })

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

  test('with a semicolon delimiter every cell splits on it, and a cell holding one stays one cell', () => {
    const fuse = { name: 'Fuse', spec: '80 A; class T', note: 'Inline, close to the bank', qty: '1' }
    const csv = buildCsv({ ...input({ appliances: true, parts: true }), parts: [fuse], delimiter: ';' })
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Appliance;Kind;Qty;Each (W);Running (W);Average (W);Wh over 10 h',
      'Refrigerator;Cycles on and off;1;150;150;53;525',
      '',
      'Part;Specification;Note;Qty',
      'Fuse;"80 A; class T";Inline, close to the bank;1',
    ])
  })

  test('the project rows open the file as label and value pairs, then a blank row', () => {
    const project = [{ label: 'Project name', value: 'Casa, playa' }, { label: 'Date', value: 'Oct 19, 2026' }]
    const lines = buildCsv({ ...input({ appliances: false, parts: true }), project }).slice(1).split('\r\n')
    expect(lines.slice(0, 4)).toEqual(['Project name,"Casa, playa"', 'Date,"Oct 19, 2026"', '', 'Part,Specification,Note,Qty'])
    expect(buildCsv({ ...input({ appliances: false, parts: false }), project, delimiter: ';' }).slice(1)).toBe('Project name;Casa, playa\r\nDate;Oct 19, 2026')
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
