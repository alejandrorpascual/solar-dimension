import { describe, expect, test } from 'vitest'
import { lineSize, readGauge, tableGauge } from './quote-gauge'

describe('readGauge', () => {
  test('reads table gauges with or without "AWG" and "#", at the table area', () => {
    expect(readGauge('2/0')).toEqual({ mm2: 67.4, label: '2/0 AWG' })
    expect(readGauge('#4 AWG')).toEqual({ mm2: 21.2, label: '4 AWG' })
    expect(readGauge('1/0AWG')).toEqual({ mm2: 53.5, label: '1/0 AWG' })
  })
  test('reads "0" to "0000" as 1/0 to 4/0', () => {
    expect(['0', '00', '000', '0000'].map((s) => readGauge(s)?.label)).toEqual(['1/0 AWG', '2/0 AWG', '3/0 AWG', '4/0 AWG'])
  })
  test('ignores the insulation or material written after the size', () => {
    expect(readGauge('2 AWG THHN')).toEqual({ mm2: 33.6, label: '2 AWG' })
    expect(readGauge('4/0 cobre')?.label).toBe('4/0 AWG')
    expect(readGauge('4/0, THHN')?.label).toBe('4/0 AWG')
    expect(readGauge('6 AWG.')?.label).toBe('6 AWG')
  })
  test('gives gauges thinner than the table their area, so they read as thinner, not as unknown', () => {
    expect(readGauge('10')).toMatchObject({ label: '10 AWG' })
    expect(readGauge('10')!.mm2).toBeCloseTo(5.26, 2)
    expect(readGauge('14 AWG')!.mm2).toBeCloseTo(2.08, 2)
  })
  test('reads kcmil and mm²', () => {
    expect(readGauge('250 kcmil')!.mm2).toBeCloseTo(126.7, 1)
    expect(readGauge('250 MCM')).toMatchObject({ label: '250 kcmil' })
    expect(readGauge('70 mm2')).toEqual({ mm2: 70, label: '70 mm²' })
    expect(readGauge('35,5 mm²')).toEqual({ mm2: 35.5, label: '35,5 mm²' })
  })
  test('reads the size after a count of conductors or runs, never the count as a gauge', () => {
    for (const s of ['2 x 4/0 AWG', '2x4/0', '2 X 4/0', '3× 4/0']) expect(readGauge(s)?.label).toBe('4/0 AWG')
    expect(readGauge('3 x 6 AWG')?.label).toBe('6 AWG')
    expect(readGauge('2 x 35 mm2')).toEqual({ mm2: 35, label: '35 mm²' })
  })
  test('reads the word for gauge written before the size', () => {
    for (const s of ['AWG 4/0', 'AWG4/0', 'Cal. 4/0', 'calibre 4/0', 'AWG #4/0']) expect(readGauge(s)?.label).toBe('4/0 AWG')
  })
  test('reads mm² written as plain mm, sq mm or mm^2, not as an AWG number', () => {
    expect(['35 mm', '35mm', '35 sqmm', '35 sq mm', '35 mm^2'].map((s) => readGauge(s))).toEqual(Array(5).fill({ mm2: 35, label: '35 mm²' }))
  })
  test('reads a slash written with spaces, and a rating after a dash', () => {
    expect(readGauge('2 / 0')?.label).toBe('2/0 AWG')
    for (const s of ['4/0 - 600V', '4/0-600V']) expect(readGauge(s)?.label).toBe('4/0 AWG')
    expect(readGauge('AWG 2 x 4/0')?.label).toBe('4/0 AWG')
  })
  test('reads a bare number as a gauge only before the unit, an insulation or a metal, and up to 14 without "AWG"', () => {
    expect(['8 THHN', '6 cobre', '10', '14'].map((s) => readGauge(s)?.label)).toEqual(['8 AWG', '6 AWG', '10 AWG', '14 AWG'])
    expect(readGauge('16 AWG')?.label).toBe('16 AWG')
    // A count ("2 tramos 4/0"), a voltage, or mm² with the unit left out ("35", "2x35") is no gauge.
    expect(['2 tramos 4/0', '3 cables 4/0', '2 cond. 4/0', '12 V', '16', '35', '2x35'].map(readGauge)).toEqual(Array(7).fill(null))
  })
  test('is null when nothing at the start reads as a size', () => {
    expect([null, '', 'heavy duty', 'AWG', '50', '5/0', '2-4/0', '2–4/0', '2.5', '6/2'].map(readGauge)).toEqual(Array(10).fill(null))
  })
})

describe('lineSize and tableGauge', () => {
  test('a stated mm² wins over the AWG text', () => {
    expect(lineSize({ mm2: 50, awg: '4/0' })).toEqual({ mm2: 50, label: '50 mm²' })
    expect(lineSize({ mm2: null, awg: '4/0' })).toEqual({ mm2: 107.2, label: '4/0 AWG' })
  })
  test('a size counts as the thickest table gauge it reaches within 5%', () => {
    expect(tableGauge(70)?.awg).toBe('2/0 AWG')
    expect(tableGauge(66)?.awg).toBe('2/0 AWG')
    expect(tableGauge(126.7)?.awg).toBe('4/0 AWG')
    expect(tableGauge(5.26)).toBeNull()
  })
})
