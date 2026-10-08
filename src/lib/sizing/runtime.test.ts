import { describe, expect, test } from 'vitest'
import { CHEMISTRIES, type CatalogItem } from '../catalog'
import { selectItems } from './loads'
import { peukertFactor, runtimeScenarios, scenarioLoadWh } from './runtime'

const base: CatalogItem = { id: 'x', name: 'X', cat: 'Utility', watts: 100, surge: 100, duty: 1, note: '' }
const lights = { ...base, id: 'lights', watts: 100, duty: 1 }
const fridge = { ...base, id: 'fridge', watts: 200, duty: 0.5 }
const items = selectItems([lights, fridge], { lights: 1, fridge: 1 }, 10, {})
const loadWh = 100 * 10 + 200 * 0.5 * 10

describe('scenarioLoadWh', () => {
  test('scales cycling duties only, clamped to 5%..100%', () => {
    expect(scenarioLoadWh(items, 10, 1)).toBe(loadWh)
    expect(scenarioLoadWh(items, 10, 0.8)).toBe(1000 + 200 * 0.4 * 10)
    expect(scenarioLoadWh(items, 10, 1.3)).toBe(1000 + 200 * 0.65 * 10)
    expect(scenarioLoadWh(items, 10, 5)).toBe(1000 + 200 * 1 * 10)
    expect(scenarioLoadWh(items, 10, 0)).toBe(1000)
  })
})

describe('peukertFactor', () => {
  test('is 1 for lithium, for no current and for a slow draw; below 1 for lead-acid drawn faster than its hour rate', () => {
    expect(peukertFactor(CHEMISTRIES.lifepo4, 200, 100)).toBe(1)
    expect(peukertFactor(CHEMISTRIES.agm, 200, 0)).toBe(1)
    expect(peukertFactor(CHEMISTRIES.agm, 200, 10)).toBe(1)
    expect(peukertFactor(CHEMISTRIES.agm, 200, 40)).toBeCloseTo((10 / 40) ** 0.15)
    expect(peukertFactor(CHEMISTRIES.agm, 200, 1)).toBe(1)
  })
})

describe('runtimeScenarios', () => {
  const ctx = { chem: CHEMISTRIES.lifepo4, items, hours: 10, loadWh, runningW: 300, volts: 48 as const }
  const bank = { bankWh: 4800, bankAh: 100, bankContinuousA: 100 }

  test('typical is the plain formula; optimistic runs longer, worst shorter', () => {
    const rt = runtimeScenarios(bank, ctx)
    expect(rt.typical).toBeCloseTo((4800 * 0.85 * 0.9) / (loadWh / 10))
    expect(rt.optimistic).toBeGreaterThan(rt.typical)
    expect(rt.worst).toBeLessThan(rt.typical)
    expect(rt.worstLimitedByDischarge).toBe(false)
  })

  test('worst case is 0 when the bank cannot carry the full running load', () => {
    const rt = runtimeScenarios({ ...bank, bankContinuousA: 5 }, ctx)
    expect(rt).toMatchObject({ worst: 0, worstLimitedByDischarge: true })
    expect(rt.typical).toBeGreaterThan(0)
  })

  test('lead-acid worst case also loses capacity to Peukert', () => {
    const agm = { ...ctx, chem: CHEMISTRIES.agm }
    const lfp = runtimeScenarios(bank, ctx)
    const pb = runtimeScenarios(bank, agm)
    expect(pb.worst / pb.typical).toBeLessThan(lfp.worst / lfp.typical)
  })

  test('a slow lead-acid draw never makes the hard day outlast the typical one', () => {
    const light = { ...ctx, chem: CHEMISTRIES.agm, loadWh: 500, runningW: 50 }
    const rt = runtimeScenarios({ bankWh: 2400, bankAh: 200, bankContinuousA: 60 }, light)
    expect(rt.worst).toBeLessThan(rt.typical)
  })

  test('no load means no runtime', () => {
    expect(runtimeScenarios(bank, { ...ctx, loadWh: 0 })).toEqual({ optimistic: 0, typical: 0, worst: 0, worstLimitedByDischarge: false })
  })
})
