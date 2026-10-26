import { describe, expect, test } from 'vitest'
import { CHEMISTRIES } from './catalog'
import { minSeries, nextWirable, panelsFit, panelsToRefill, sizeSolar, SOLAR } from './solar'

// The design's sample: 48 V, 2 × 48 V 200 Ah = 19,200 Wh bank, 1,100 W average draw.
const BANK_WH = 19_200
const AVERAGE_W = 1_100
/** A bank that gives back all it holds and keeps all it is given, so the wiring tests read in plain panel arithmetic. */
const LOSSLESS = { dod: 1, chargeEff: 1 }
const VOLTAGES = [12, 24, 36, 48] as const
/** Charge voltage plus the 5 V an MPPT controller needs above it, per bank voltage. */
const NEEDS_V = { 12: 19.4, 24: 33.8, 36: 48.2, 48: 62.6 } as const
const hotVmp = (inSeries: number) => inSeries * SOLAR.PANEL_VMP * SOLAR.HOT_VMP_DERATE
/** Most panels one controller carries as equal strings, 2 at most: 2 at 12 V, 1 × 5 at 24 V, 2 × 3 at 36 V (7 in series is too long), 2 × 5 at 48 V. */
const MOST_ON_ONE = { 12: 2, 24: 5, 36: 6, 48: 10 } as const

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

describe('refilling the usable energy over charge losses', () => {
  const pick = (chemistry: typeof CHEMISTRIES.lifepo4) =>
    sizeSolar({ solar: { roofM2: 40, panels: null, sunHours: 4.5 }, bankWh: 10_000, chemistry, volts: 48, averageW: AVERAGE_W })!

  test('a 10 kWh LiFePO4 bank at 4.5 sun hours recommends 5 panels and a 10 kWh AGM bank 4', () => {
    // One panel: 550 × 4.5 × 0.75 = 1,856 Wh a clear day.
    // LiFePO4: 10,000 × 0.85 usable / 0.92 charge efficiency = 9,239 Wh → 4.98 → 5. AGM: 10,000 × 0.5 / 0.8 = 6,250 Wh → 3.37 → 4.
    expect([pick(CHEMISTRIES.lifepo4), pick(CHEMISTRIES.agm)].map((s) => [s.need, s.recommended, s.panels])).toEqual([[5, 5, 5], [4, 4, 4]])
  })

  test("coverage is exactly 100% when a clear day's yield equals a day's use over the inverter's 0.9", () => {
    // 4 panels at 5 h: 2,200 × 5 × 0.75 = 8,250 Wh into the bank. A day's use of 7,425 Wh at the appliances (309.375 W × 24 h)
    // takes 7,425 / 0.9 = 8,250 Wh out of it.
    const s = sizeSolar({ solar: { roofM2: 40, panels: 4, sunHours: 5 }, bankWh: 10_000, chemistry: CHEMISTRIES.lifepo4, volts: 48, averageW: 309.375 })!
    expect([s.dailyWh, s.dailyUseWh, s.coverRatio]).toEqual([8250, 7425, 1])
  })

  test('the refill time is the usable energy over charge losses', () => {
    // 9,239 Wh into 5 × 550 × 0.75 = 2,062.5 W of charge is 4.48 h, inside the 4.5 h of sun; 6,250 / (4 × 412.5) = 3.79 h.
    expect([pick(CHEMISTRIES.lifepo4), pick(CHEMISTRIES.agm)].map((s) => [Number(s.refillHours?.toFixed(2)), s.refillsInOneDay])).toEqual([[4.48, true], [3.79, true]])
  })

  test('a roof-limited LiFePO4 array takes the usable energy over charge losses in days, not the whole bank', () => {
    // 20 m² fits 6 panels: 6 × 550 × 5 × 0.75 = 12,375 Wh a clear day. 19,200 × 0.85 / 0.92 = 17,739 Wh to refill, so 1.43 days.
    // Dividing the whole 19,200 Wh bank instead would read 1.55.
    const s = sizeSolar({ solar: { roofM2: 20, panels: null, sunHours: 5 }, bankWh: BANK_WH, chemistry: CHEMISTRIES.lifepo4, volts: 48, averageW: AVERAGE_W })!
    expect([s.panels, s.dailyWh, Math.round(s.refillWh), s.refillsInOneDay]).toEqual([6, 12_375, 17_739, false])
    expect(s.refillDays).toBeCloseTo(1.43, 2)
  })
})

describe('sizeSolar', () => {
  const base = { solar: { roofM2: 40, panels: null, sunHours: 5 }, bankWh: BANK_WH, chemistry: LOSSLESS, volts: 48 as const, averageW: AVERAGE_W }

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
    // 20,625 Wh against the 26,400 / 0.9 = 29,333 Wh a day's use takes out of the bank.
    expect(s.coverRatio).toBeCloseTo(0.703, 3)
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
    expect(s.controllers).toBe(3)
    expect(s.controllerA).toBe(80)
    expect([s.panels, s.strings, s.perString, s.stringVoc, s.pvCablePairs, s.breakerA]).toEqual([5, 5, 1, 50, 5, 40])
  })

  test('7 panels on a roof that fits 8 become 2 strings of 4', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 25, panels: 7, sunHours: 5 } })!
    expect([s.fit, s.panels]).toEqual([8, 8])
    expect(s.strings).toBe(2)
    expect(s.perString).toBe(4)
    expect(s.stringVoc).toBe(198)
    expect(s.controllers).toBe(1)
  })

  test('a count that does not split rounds down when rounding up would pass the roof', () => {
    const s = sizeSolar({ ...base, solar: { roofM2: 21, panels: 7, sunHours: 5 } })!
    expect([s.fit, s.panels, s.strings, s.perString]).toEqual([7, 6, 2, 3])
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
  const base = { bankWh: BANK_WH, chemistry: LOSSLESS, averageW: AVERAGE_W }

  test("one panel's hot maximum-power voltage clears 24 V and falls short of 36 V, so strings need 2 in series at 36 and 48 V", () => {
    expect([hotVmp(1) > NEEDS_V[24], hotVmp(1) < NEEDS_V[36]]).toEqual([true, true])
    expect(VOLTAGES.map(minSeries)).toEqual([1, 1, 2, 2])
  })

  test('48 V on a 5 m² roof has no yield and says the string is too short', () => {
    const s = sizeSolar({ ...base, volts: 48, solar: { roofM2: 5, panels: null, sunHours: 4.8 } })!
    expect([s.fit, s.wiredFit, s.panels, s.dailyWh, s.strings, s.isTooShort]).toEqual([1, 0, 0, 0, 0, true])
  })

  test('one panel at 12 or 24 V still gives a yield', () => {
    const pick = (volts: 12 | 24) => sizeSolar({ ...base, volts, solar: { roofM2: 5, panels: null, sunHours: 4.8 } })!
    expect([pick(12), pick(24)].map((s) => [s.panels, s.dailyWh, s.isTooShort])).toEqual([[1, 1980, false], [1, 1980, false]])
  })

  test('the recommendation and a tapped single panel start at the shortest string that charges', () => {
    // 1,000 Wh refills from one panel; at 48 V that panel needs a second in series.
    const pick = (volts: 24 | 48, panels: number | null = null) => sizeSolar({ bankWh: 1000, chemistry: LOSSLESS, averageW: AVERAGE_W, volts, solar: { roofM2: 40, panels, sunHours: 5 } })!
    expect([pick(48).recommended, pick(48).perString, pick(24).recommended]).toEqual([2, 2, 1])
    expect([pick(48, 1).panels, pick(48, 1).strings, pick(48, 1).perString]).toEqual([2, 1, 2])
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
      }
    }
  })

  test('any tapped count becomes the nearest count that wires as equal strings on the fewest controllers, a tie rounding up, never past the roof', () => {
    // Lengths a string may have: from the shortest that charges to 5, and at 12 V at most the 2 one 100 A controller passes.
    const lengths = { 12: [1, 2], 24: [1, 2, 3, 4, 5], 36: [2, 3, 4, 5], 48: [2, 3, 4, 5] } as const
    for (const volts of VOLTAGES) {
      const most = MOST_ON_ONE[volts]
      // n / len strings, at most 2 to a controller and `most` panels on it, on no more controllers than n panels need.
      const wires = (n: number) => n === 0 || lengths[volts].some((len) => n % len === 0 && Math.ceil(n / len / Math.min(2, Math.floor(most / len))) === Math.ceil(n / most))
      for (let roofM2 = SOLAR.ROOF_RANGE[0]; roofM2 <= SOLAR.ROOF_RANGE[1]; roofM2 += SOLAR.ROOF_STEP) {
        const fit = panelsFit(roofM2)
        const wirable = Array.from({ length: fit + 1 }, (_, n) => n).filter(wires)
        for (let tapped = 0; tapped <= fit; tapped++) {
          const nearest = wirable.reduce((best, n) => (Math.abs(n - tapped) <= Math.abs(best - tapped) ? n : best))
          const s = sizeSolar({ ...base, volts, solar: { roofM2, panels: tapped, sunHours: 5 } })!
          expect([s.panels, s.wiredFit], `${volts} V · ${tapped} tapped on ${roofM2} m²`).toEqual([nearest, wirable.at(-1)])
        }
      }
    }
  })

  test('25 panels give 5 strings of 5', () => {
    const s = sizeSolar({ ...base, volts: 48, solar: { roofM2: 100, panels: 25, sunHours: 5 } })!
    expect([s.panels, s.strings, s.perString]).toEqual([25, 5, 5])
  })
})

describe('controllers, breakers and taps', () => {
  const base = { bankWh: BANK_WH, chemistry: LOSSLESS, averageW: AVERAGE_W }
  const pick = (volts: (typeof VOLTAGES)[number], roofM2: number, panels: number | null, bankWh = BANK_WH) => sizeSolar({ ...base, bankWh, volts, solar: { roofM2, panels, sunHours: 5 } })!

  test('across every voltage and 1–166 panels, the fewest controllers carry them, each with its breaker covering the strings on it, never more than 2', () => {
    for (const volts of VOLTAGES) {
      for (let panels = 1; panels <= panelsFit(SOLAR.ROOF_RANGE[1]); panels++) {
        const s = pick(volts, 500, panels)
        const at = `${volts} V · ${s.strings} strings of ${s.perString} on ${s.controllers}`
        const onFullest = Math.ceil(s.strings / s.controllers)
        // A panel's 14 A short-circuit current plus the breaker's 1.25 margin; two strings in parallel need no fuse each, and the kit lists none.
        expect(s.breakerA, at).toBeGreaterThanOrEqual(14 * onFullest * 1.25)
        expect(s.controllerA, at).toBeGreaterThanOrEqual((onFullest * s.perString * SOLAR.PANEL_W) / SOLAR.CHARGE_V[volts])
        expect([onFullest <= 2, s.controllers], at).toEqual([true, Math.ceil(s.panels / MOST_ON_ONE[volts])])
      }
    }
  })

  test('a count that splits only into short strings rounds to one that needs no extra controllers; 12 panels at 48 V take 2 × 60 A, not 2 × 80 A', () => {
    // 7 one-panel strings at 24 V would take 4 controllers where 8 = 2 × 4 takes 2; 166 at 48 V = 83 × 2 would take 42 where 165 = 33 × 5 takes 17.
    expect([pick(24, 40, 7), pick(48, 500, 166)].map((s) => [s.panels, s.strings, s.perString, s.controllers])).toEqual([[8, 2, 4, 2], [165, 33, 5, 17]])
    const s48 = pick(48, 40, 12)
    expect([s48.strings, s48.perString, s48.controllers, s48.controllerA, s48.breakerA]).toEqual([4, 3, 2, 60, 40])
  })

  test('adding panel n lights it and removing it leaves the most panels below n that wire; every tile can light, on every voltage and roof', () => {
    // Up to its wired fit a roof changes no count that wires, so the largest roof walks every tile once; each roof adds only its own top tile.
    const largest = SOLAR.ROOF_RANGE[1]
    for (const volts of VOLTAGES) {
      const { wiredFit } = pick(volts, largest, null)
      for (let n = 1; n <= wiredFit; n++) {
        const at = `${volts} V · panel ${n}`
        const left = pick(volts, largest, nextWirable(n, -1, volts)).panels
        expect([left < n, pick(volts, largest, nextWirable(n - 1, 1, volts)).panels >= n], at).toEqual([true, true])
        // No count between what is left and n would have stayed as asked.
        for (let k = left + 1; k < n; k++) expect(pick(volts, largest, k).panels, `${at} · ${k}`).not.toBe(k)
      }
      for (let roofM2 = SOLAR.ROOF_RANGE[0]; roofM2 <= largest; roofM2 += SOLAR.ROOF_STEP) {
        const top = pick(volts, roofM2, null).wiredFit
        expect(pick(volts, roofM2, nextWirable(top - 1, 1, volts)).panels, `${volts} V · top tile ${top} on ${roofM2} m²`).toBe(top)
      }
    }
  })

  test('at 48 V removing panel 8 leaves 6, removing panel 2 leaves none and adding panel 11 lights 12; at 24 V removing panel 8 leaves 6', () => {
    expect([nextWirable(8, -1, 48), nextWirable(2, -1, 48), nextWirable(10, 1, 48), nextWirable(8, -1, 24)]).toEqual([6, 0, 12, 6])
  })

  test('the roof reads as the limit exactly when the recommendation falls short of the need', () => {
    for (const volts of VOLTAGES) {
      for (let roofM2 = SOLAR.ROOF_RANGE[0]; roofM2 <= 150; roofM2 += SOLAR.ROOF_STEP) {
        for (let need = 1; need <= 40; need++) {
          const s = pick(volts, roofM2, null, need * SOLAR.PANEL_W * 5 * SOLAR.SYSTEM_EFF)
          expect(s.isRoofLimited, `${volts} V · ${s.recommended} recommended for ${need} on ${roofM2} m²`).toBe(s.recommended < need)
        }
      }
    }
    // 48 V on 35 m² holds 11 but wires 10; a bank that needs 11 is roof-limited.
    expect([pick(48, 35, null, 21_000)].map((s) => [s.fit, s.wiredFit, s.recommended, s.isRoofLimited])).toEqual([[11, 10, 10, true]])
  })
})

describe('the figures the solar flow prints', () => {
  test('a clear day has what is left after refilling the bank to spare, not what is left after a day of use', () => {
    // 5 panels at 4.8 h: 2,750 × 4.8 × 0.75 = 9,900 Wh. Refilling a lossless 9,600 Wh bank leaves 300 Wh.
    // Taking a day's use instead (100 W × 24 h = 2,400 Wh) would leave 7,500 Wh.
    const s = sizeSolar({ solar: { roofM2: 40, panels: 5, sunHours: 4.8 }, bankWh: 9_600, chemistry: LOSSLESS, volts: 48, averageW: 100 })!
    expect([s.panels, s.dailyWh, s.dailyUseWh, s.spareWh]).toEqual([5, 9_900, 2_400, 300])
  })

  test('nothing is spare when a clear day does not refill the bank', () => {
    const s = sizeSolar({ solar: { roofM2: 40, panels: 2, sunHours: 4.8 }, bankWh: 9_600, chemistry: LOSSLESS, volts: 48, averageW: 100 })!
    expect(s.spareWh).toBe(0)
  })

  test("the chart reaches a day's use when it is past the clear-day yield", () => {
    // 1 panel at 4.8 h at 12 V yields 1,980 Wh; a 2,000 W load uses 48,000 Wh a day. A chart sized to the yield alone stops at 26,400 Wh.
    const s = sizeSolar({ solar: { roofM2: 40, panels: 1, sunHours: 4.8 }, bankWh: 9_600, chemistry: LOSSLESS, volts: 12, averageW: 2_000 })!
    expect([s.panels, s.dailyWh, s.dailyUseWh, s.chart.maxWh, s.chart.useShare]).toEqual([1, 1_980, 48_000, 48_000, 1])
  })

  test('a small kit keeps the chart at its 26.4 kWh floor, and a large one rounds up to the next 2 kWh', () => {
    const small = sizeSolar({ solar: { roofM2: 40, panels: 5, sunHours: 4.8 }, bankWh: 9_600, chemistry: LOSSLESS, volts: 48, averageW: 100 })!
    expect(small.chart.maxWh).toBe(26_400)
    // 10 panels at 5 h yield 20,625 Wh; 1,100 W uses 26,400 Wh; 1,200 W uses 28,800 Wh, so the chart goes to 30,000 Wh.
    const large = sizeSolar({ solar: { roofM2: 40, panels: null, sunHours: 5 }, bankWh: BANK_WH, chemistry: LOSSLESS, volts: 48, averageW: 1_200 })!
    expect(large.chart.maxWh).toBe(30_000)
  })

  test("the bar fills with the use a clear day carries, against the day's-use mark", () => {
    // 20,625 Wh into the bank carries 20,625 × 0.9 = 18,562.5 Wh of use; the day's use is 26,400 Wh, so the chart runs to 28,000 Wh.
    const s = sizeSolar({ solar: { roofM2: 40, panels: null, sunHours: 5 }, bankWh: BANK_WH, chemistry: LOSSLESS, volts: 48, averageW: AVERAGE_W })!
    expect(s.chart.maxWh).toBe(28_000)
    expect(s.chart.carriedShare).toBeCloseTo(0.663, 3)
    expect(s.chart.useShare).toBeCloseTo(0.943, 3)
  })

  test("a cloudy day covers 40% of what a clear day covers of a day's use", () => {
    const s = sizeSolar({ solar: { roofM2: 40, panels: null, sunHours: 5 }, bankWh: BANK_WH, chemistry: LOSSLESS, volts: 48, averageW: AVERAGE_W })!
    // 0.703 of a day's use on a clear day; 40% of that is 0.281.
    expect(s.cloudyCoverRatio).toBeCloseTo(0.281, 3)
  })
})
