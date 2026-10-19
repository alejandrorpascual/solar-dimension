import { describe, expect, test } from 'vitest'
import { minSeries, panelsBelow, panelsFit, panelsToRefill, recommendedPanels, sizeSolar, SOLAR } from './solar'

// The design's sample: 48 V, 2 × 48 V 200 Ah = 19,200 Wh bank, 1,100 W average draw.
const BANK_WH = 19_200
const AVERAGE_W = 1_100
const VOLTAGES = [12, 24, 36, 48] as const
/** Charge voltage plus the 5 V an MPPT controller needs above it, per bank voltage. */
const NEEDS_V = { 12: 19.4, 24: 33.8, 36: 48.2, 48: 62.6 } as const
const hotVmp = (inSeries: number) => inSeries * SOLAR.PANEL_VMP * SOLAR.HOT_VMP_DERATE

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
    // Clamped to the 13 the roof fits; 13 does not split into equal strings and 14 is past the roof, so 12.
    expect(sizeSolar({ ...base, solar: { ...base.solar, panels: 40 } })!.panels).toBe(12)
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

  test('at 12 V an odd count runs as one-panel strings, two to a controller', () => {
    // 100 A at 14.4 V passes 2 panels, so no string is longer than 2; 5 does not split into 2s, so 5 strings of 1
    // on 3 controllers (2 + 2 + 1 strings). The fullest carries 2 × 550 / 14.4 = 76 A behind 2 × 14 A × 1.25 = 35 A.
    const s = sizeSolar({ ...base, volts: 12, solar: { roofM2: 40, panels: 5, sunHours: 5 } })!
    expect(s.panels).toBe(5)
    expect(s.controllers).toBe(3)
    expect(s.controllerA).toBe(80)
    expect(s.strings).toBe(5)
    expect(s.perString).toBe(1)
    expect(s.stringVoc).toBe(50)
    expect(s.pvCablePairs).toBe(5)
    expect(s.breakerA).toBe(40)
  })

  test('7 panels on a roof that fits 8 become 2 strings of 4', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 25, panels: 7, sunHours: 5 } })!
    expect(s.fit).toBe(8)
    expect(s.panels).toBe(8)
    expect(s.strings).toBe(2)
    expect(s.perString).toBe(4)
    expect(s.stringVoc).toBe(198)
    expect(s.controllers).toBe(1)
  })

  test('a count that does not split rounds down when rounding up would pass the roof', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 21, panels: 7, sunHours: 5 } })!
    expect(s.fit).toBe(7)
    expect(s.panels).toBe(6)
    expect(s.strings).toBe(2)
    expect(s.perString).toBe(3)
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

describe('string length against the charge voltage', () => {
  const base = { bankWh: BANK_WH, averageW: AVERAGE_W }

  test("one panel's hot maximum-power voltage clears 24 V and falls short of 36 V", () => {
    expect(hotVmp(1)).toBeGreaterThan(NEEDS_V[24])
    expect(hotVmp(1)).toBeLessThan(NEEDS_V[36])
  })

  test('strings need 2 panels in series at 36 and 48 V, 1 at 12 and 24 V', () => {
    expect(VOLTAGES.map(minSeries)).toEqual([1, 1, 2, 2])
  })

  test('48 V on a 5 m² roof has no yield and says the string is too short', () => {
    const s = sizeSolar({ ...base, volts: 48, solar: { roofM2: 5, panels: null, sunHours: 4.8 } })!
    expect(s.fit).toBe(1)
    expect(s.panels).toBe(0)
    expect(s.dailyWh).toBe(0)
    expect(s.strings).toBe(0)
    expect(s.isTooShort).toBe(true)
  })

  test('one panel at 12 or 24 V still gives a yield', () => {
    for (const volts of [12, 24] as const) {
      const s = sizeSolar({ ...base, volts, solar: { roofM2: 5, panels: null, sunHours: 4.8 } })!
      expect(s.panels).toBe(1)
      expect(s.dailyWh).toBe(1980)
      expect(s.isTooShort).toBe(false)
    }
  })

  test('the recommendation starts at the shortest string that charges', () => {
    // 1,000 Wh refills from one panel; at 48 V that panel needs a second in series.
    const pick = (volts: 24 | 48) => sizeSolar({ bankWh: 1000, averageW: AVERAGE_W, volts, solar: { roofM2: 40, panels: null, sunHours: 5 } })!
    expect(pick(48).recommended).toBe(2)
    expect(pick(48).perString).toBe(2)
    expect(pick(24).recommended).toBe(1)
  })

  test('a tapped single panel at 48 V becomes a string of 2', () => {
    const s = sizeSolar({ ...base, volts: 48, solar: { roofM2: 40, panels: 1, sunHours: 5 } })!
    expect(s.panels).toBe(2)
    expect(s.strings).toBe(1)
    expect(s.perString).toBe(2)
  })

  test('across every voltage and 1–166 panels, the shortest string charges or there is no yield', () => {
    for (const volts of VOLTAGES) {
      for (let panels = 1; panels <= panelsFit(SOLAR.ROOF_RANGE[1]); panels++) {
        for (const roofM2 of [5, 500]) {
          const s = sizeSolar({ ...base, volts, solar: { roofM2, panels, sunHours: 5 } })!
          if (s.panels === 0) {
            expect([volts, panels, roofM2, s.dailyWh, s.isTooShort]).toEqual([volts, panels, roofM2, 0, true])
          } else {
            expect(hotVmp(s.perString), `${volts} V · ${panels} on ${roofM2} m²`).toBeGreaterThan(NEEDS_V[volts])
          }
        }
      }
    }
  })

  test('across 1–166 panels, every string has the same length and they add up to the panel count', () => {
    for (const volts of VOLTAGES) {
      for (let panels = 1; panels <= panelsFit(SOLAR.ROOF_RANGE[1]); panels++) {
        const s = sizeSolar({ ...base, volts, solar: { roofM2: 500, panels, sunHours: 5 } })!
        expect(s.strings * s.perString, `${volts} V · ${panels} panels`).toBe(s.panels)
        expect(s.perString).toBeLessThanOrEqual(SOLAR.MAX_PER_STRING)
        expect(s.controllerA).toBeLessThanOrEqual(SOLAR.CONTROLLER_AMPS[SOLAR.CONTROLLER_AMPS.length - 1]!)
      }
    }
  })

  test('any tapped count becomes the nearest count that wires as equal strings, a tie rounding up, never past the roof', () => {
    // Lengths a string may have: from the shortest that charges to 5, and at 12 V at most the 2 one 100 A controller passes.
    const lengths = { 12: [1, 2], 24: [1, 2, 3, 4, 5], 36: [2, 3, 4, 5], 48: [2, 3, 4, 5] } as const
    for (const volts of VOLTAGES) {
      const wires = (n: number) => n === 0 || lengths[volts].some((len) => n % len === 0)
      for (let roofM2 = SOLAR.ROOF_RANGE[0]; roofM2 <= SOLAR.ROOF_RANGE[1]; roofM2 += SOLAR.ROOF_STEP) {
        const fit = panelsFit(roofM2)
        const wirable = Array.from({ length: fit + 1 }, (_, n) => n).filter(wires)
        for (let tapped = 0; tapped <= fit; tapped++) {
          const nearest = [...wirable].sort((a, b) => Math.abs(a - tapped) - Math.abs(b - tapped) || b - a)[0]
          const s = sizeSolar({ ...base, volts, solar: { roofM2, panels: tapped, sunHours: 5 } })!
          expect(s.panels, `${volts} V · ${tapped} tapped on ${roofM2} m²`).toBe(nearest)
        }
      }
    }
  })

  test('25 panels give 5 strings of 5', () => {
    const s = sizeSolar({ ...base, volts: 48, solar: { roofM2: 100, panels: 25, sunHours: 5 } })!
    expect(s.panels).toBe(25)
    expect(s.strings).toBe(5)
    expect(s.perString).toBe(5)
  })
})

describe('controller breakers and remove taps', () => {
  const base = { bankWh: BANK_WH, averageW: AVERAGE_W }
  const pick = (volts: (typeof VOLTAGES)[number], roofM2: number, panels: number) => sizeSolar({ ...base, volts, solar: { roofM2, panels, sunHours: 5 } })!

  test('across every voltage and 1–166 panels, each controller and its breaker cover the strings on it, never more than 2', () => {
    for (const volts of VOLTAGES) {
      for (let panels = 1; panels <= panelsFit(SOLAR.ROOF_RANGE[1]); panels++) {
        const s = pick(volts, 500, panels)
        const at = `${volts} V · ${s.strings} strings of ${s.perString} on ${s.controllers}`
        const onFullest = Math.ceil(s.strings / s.controllers)
        // A panel's 14 A short-circuit current plus the breaker's 1.25 margin; two strings in parallel need no fuse each, and the kit lists none.
        expect(s.breakerA, at).toBeGreaterThanOrEqual(14 * onFullest * 1.25)
        expect(s.controllerA, at).toBeGreaterThanOrEqual((onFullest * s.perString * SOLAR.PANEL_W) / SOLAR.CHARGE_V[volts])
        expect(onFullest, at).toBeLessThanOrEqual(2)
      }
    }
  })

  test('7 one-panel strings at 24 V go 2 to a controller; 12 panels at 48 V take 2 × 60 A, not 2 × 80 A', () => {
    // 4 strings on one controller would need 14 A × 4 × 1.25 = 70 A, past the 63 A the breaker list stops at.
    const s24 = pick(24, 40, 7)
    expect([s24.strings, s24.perString, s24.controllers, s24.controllerA, s24.breakerA]).toEqual([7, 1, 4, 40, 40])
    const s48 = pick(48, 40, 12)
    expect([s48.strings, s48.perString, s48.controllers, s48.controllerA, s48.breakerA]).toEqual([4, 3, 2, 60, 40])
  })

  test('removing panel n leaves the most panels below n that wire, on every voltage and roof', () => {
    for (const volts of VOLTAGES) {
      for (let roofM2 = SOLAR.ROOF_RANGE[0]; roofM2 <= SOLAR.ROOF_RANGE[1]; roofM2 += SOLAR.ROOF_STEP) {
        for (let n = 1; n <= panelsFit(roofM2); n++) {
          const at = `${volts} V · remove panel ${n} on ${roofM2} m²`
          const left = pick(volts, roofM2, panelsBelow(n, volts)).panels
          expect(left, at).toBeLessThan(n)
          // No count between what is left and n would have stayed as asked.
          for (let k = left + 1; k < n; k++) expect(pick(volts, roofM2, k).panels, `${at} · ${k}`).not.toBe(k)
        }
      }
    }
  })

  test('at 48 V removing panel 8 leaves 6 and removing panel 2 leaves none; at 24 V removing panel 8 leaves 7', () => {
    expect([panelsBelow(8, 48), panelsBelow(2, 48), panelsBelow(8, 24)]).toEqual([6, 0, 7])
  })
})
