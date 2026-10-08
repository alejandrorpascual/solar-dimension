import { describe, expect, test } from 'vitest'
import { panelsFit, panelsToRefill, recommendedPanels, sizeSolar, SOLAR } from './solar'

// The design's sample: 48 V, 2 × 48 V 200 Ah = 19,200 Wh bank, 1,100 W average draw.
const BANK_WH = 19_200
const AVERAGE_W = 1_100

describe('panelsFit', () => {
  test('three square metres per panel, rounded down, never negative', () => {
    expect(panelsFit(40)).toBe(13)
    expect(panelsFit(5)).toBe(1)
    expect(panelsFit(2)).toBe(0)
    expect(panelsFit(-10)).toBe(0)
  })
})

describe('panelsToRefill', () => {
  test('is the panels that refill the whole bank in one clear day', () => {
    // 19,200 / (550 × 5 × 0.75) = 9.3 → 10
    expect(panelsToRefill(BANK_WH, 5)).toBe(10)
    // 19,200 / (550 × 4.8 × 0.75) = 9.7 → 10
    expect(panelsToRefill(BANK_WH, 4.8)).toBe(10)
    expect(panelsToRefill(BANK_WH, 3)).toBe(16)
    expect(panelsToRefill(0, 5)).toBe(0)
  })
})

describe('recommendedPanels', () => {
  test('is the refill count, capped by the roof', () => {
    expect(recommendedPanels({ bankWh: BANK_WH, roofM2: 40, sunHours: 5 })).toBe(10)
    expect(recommendedPanels({ bankWh: BANK_WH, roofM2: 20, sunHours: 5 })).toBe(6)
  })
})

describe('sizeSolar', () => {
  const base = { solar: { roofM2: 40, panels: null, sunHours: 5 }, bankWh: BANK_WH, volts: 48 as const, averageW: AVERAGE_W }

  test('returns null without a solar choice', () => {
    expect(sizeSolar({ ...base, solar: null })).toBeNull()
  })

  test('sizes the recommended array at 48 V', () => {
    const s = sizeSolar(base)!
    expect(s.panels).toBe(10)
    expect(s.isRecommended).toBe(true)
    expect(s.recommended).toBe(10)
    expect(s.fit).toBe(13)
    expect(s.arrayW).toBe(5500)
    expect(s.roofUsedM2).toBe(30)
    expect(s.dailyWh).toBe(20625)
    expect(s.cloudyWh).toBe(8250)
    expect(s.dailyUseWh).toBe(26400)
    expect(s.coverRatio).toBeCloseTo(0.78, 2)
    expect(s.refillHours).toBeCloseTo(4.65, 1)
    expect(s.refillsInOneDay).toBe(true)
    expect(s.strings).toBe(2)
    expect(s.perString).toBe(5)
    expect(s.stringVoc).toBe(248)
    expect(s.chargeA).toBe(95)
    expect(s.controllers).toBe(1)
    expect(s.controllerA).toBe(100)
    expect(s.pvCablePairs).toBe(2)
    expect(s.pvRunM).toBe(20)
    expect(s.breakerA).toBe(40)
    expect(s.isRoofLimited).toBe(false)
  })

  test('a tapped count overrides the recommendation and is clamped to the roof', () => {
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 12 } })!.panels).toBe(12)
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 12 } })!.isRecommended).toBe(false)
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 40 } })!.panels).toBe(13)
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 0 } })!.panels).toBe(0)
  })

  test('a small roof limits the array and says so', () => {
    const s = sizeSolar({ ...base, solar: { ...base.solar, roofM2: 20 } })!
    expect(s.panels).toBe(6)
    expect(s.isRoofLimited).toBe(true)
    expect(s.refillsInOneDay).toBe(false)
    expect(s.refillDays).toBeCloseTo(1.55, 2)
  })

  test('a big array at 48 V needs three controllers and splits the strings', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 100, panels: 24, sunHours: 5 } })!
    expect(s.arrayW).toBe(13200)
    expect(s.chargeA).toBe(229)
    expect(s.controllers).toBe(3)
    expect(s.controllerA).toBe(80)
    expect(s.strings).toBe(6)
    expect(s.perString).toBe(4)
    expect(s.breakerA).toBe(40)
  })

  test('at 12 V the same panels push far more current', () => {
    const s = sizeSolar({ ...base, volts: 12, solar: { roofM2: 40, panels: 4, sunHours: 5 } })!
    expect(s.chargeA).toBe(153)
    expect(s.controllers).toBe(2)
    expect(s.controllerA).toBe(80)
    expect(s.strings).toBe(2)
    expect(s.perString).toBe(2)
    expect(s.stringVoc).toBe(99)
    expect(s.pvCablePairs).toBe(2)
    // 14 A × 1 string per controller × 1.25 = 17.5 → 20 A
    expect(s.breakerA).toBe(20)
  })

  test('every controller gets its own string and is rated for the panels it carries', () => {
    // 100 A at 14.4 V passes 2 panels, so 5 panels need 3 controllers (2 + 2 + 1), one string each; no controller sees more than 2 × 550 / 14.4 = 76 A
    const s = sizeSolar({ ...base, volts: 12, solar: { roofM2: 40, panels: 5, sunHours: 5 } })!
    expect(s.controllers).toBe(3)
    expect(s.controllerA).toBe(80)
    expect(s.strings).toBe(3)
    expect(s.perString).toBe(2)
    expect(s.stringVoc).toBe(99)
    expect(s.pvCablePairs).toBe(3)
    expect(s.breakerA).toBe(20)
  })

  test('an uneven split rounds the string length up', () => {
    // 7 panels → 2 strings of 4 (not 5 + 2); 3,850 W / 57.6 V = 67 A → 1 controller
    const s = sizeSolar({ ...base, solar: { roofM2: 40, panels: 7, sunHours: 5 } })!
    expect(s.strings).toBe(2)
    expect(s.perString).toBe(4)
    expect(s.stringVoc).toBe(198)
    expect(s.controllers).toBe(1)
  })

  test('no panels gives zero production and no refill time', () => {
    const s = sizeSolar({ ...base, bankWh: 0, solar: { roofM2: 40, panels: null, sunHours: 5 } })!
    expect(s.panels).toBe(0)
    expect(s.dailyWh).toBe(0)
    expect(s.refillHours).toBeNull()
    expect(s.refillDays).toBeNull()
    expect(s.strings).toBe(0)
    expect(s.controllers).toBe(0)
  })

  test('clamps roof and sun hours to their ranges', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 9999, panels: null, sunHours: 99 } })!
    expect(s.roofM2).toBe(SOLAR.ROOF_RANGE[1])
    expect(s.sunHours).toBe(SOLAR.SUN_RANGE[1])
  })
})
