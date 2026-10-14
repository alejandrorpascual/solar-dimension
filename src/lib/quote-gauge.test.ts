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
  test('is null when nothing at the start reads as a size', () => {
    expect([null, '', 'heavy duty', 'AWG', '50', '5/0'].map(readGauge)).toEqual([null, null, null, null, null, null])
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
