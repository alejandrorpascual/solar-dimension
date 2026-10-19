import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { OVERSIZE_RATIO, oversizeNote } from './oversize'
import { DEFAULT_ELECTRICAL, type Project } from './schema'

const project = (qty: Record<string, number>, patch: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Home', qty, custom: [], hours: 8, volts: 48, chemistry: 'lifepo4', batteryUnit: null, requester: null,
  dutyOverrides: {}, electrical: DEFAULT_ELECTRICAL, solar: null, updatedAt: 0, ...patch,
})

describe('oversizeNote', () => {
  test('a router alone for 8 h at 48 V gets the note, naming 12 V as the voltage that sizes the smallest bank', () => {
    // CALC-19: 209 Wh needed, a 3 kW inverter and a 4.8 kWh bank at 48 V; 12 V sizes one 12 V 100 Ah battery.
    expect(oversizeNote(project({ router: 1 }), CATALOG_SNAPSHOT)).toEqual({ ratio: 22, needWh: 209, inverterW: 3000, volts: 12, bankWh: 1200 })
  })

  test('the same router at 12 V gets no note: no other voltage sizes a smaller bank', () => {
    expect(oversizeNote(project({ router: 1 }, { volts: 12 }), CATALOG_SNAPSHOT)).toBeNull()
  })

  test('a bank just under 3 times its need gets no note, though 12 V would size a smaller one', () => {
    // A fridge for 24 h at 48 V needs 1,647 Wh and gets 4.8 kWh: 2.9 times. 12 V sizes 2.4 kWh.
    expect(oversizeNote(project({ fridge: 1 }, { hours: 24 }), CATALOG_SNAPSHOT)).toBeNull()
  })

  test('the threshold is 3 times the energy the load needs', () => {
    expect(OVERSIZE_RATIO).toBe(3)
  })

  test('a fridge for 8 h at 36 V gets the note: the 4 kW inverter needs a 7.2 kWh bank, 12 V sizes 1.2 kWh', () => {
    // CALC-34: only the 4 and 5 kW stock inverters are sold for 36 V.
    expect(oversizeNote(project({ fridge: 1 }, { volts: 36 }), CATALOG_SNAPSHOT)).toEqual({ ratio: 13, needWh: 549, inverterW: 4000, volts: 12, bankWh: 1200 })
  })

  test('two voltages that size the same smallest bank: the higher one is named, it carries less current', () => {
    // A fridge for 24 h at 36 V: 12 V and 24 V both size a 2.4 kWh bank.
    expect(oversizeNote(project({ fridge: 1 }, { hours: 24, volts: 36 }), CATALOG_SNAPSHOT)).toMatchObject({ volts: 24, bankWh: 2400 })
  })

  test('a smaller bank that would fail a check this kit passes is not offered', () => {
    // Two microwaves for 1 h on AGM at 48 V: 12 V sizes 1.2 kWh, too little to feed its 3 kW inverter; 24 V sizes 14.4 kWh.
    expect(oversizeNote(project({ micro: 2 }, { hours: 1, chemistry: 'agm' }), CATALOG_SNAPSHOT)).toMatchObject({ volts: 24, bankWh: 14400 })
  })

  test('a battery picked by hand is the bank the note measures; the other voltages use their automatic pick', () => {
    // A router at 48 V on a 48 V 314 Ah battery: 15.1 kWh for 209 Wh.
    expect(oversizeNote(project({ router: 1 }, { batteryUnit: '48-314' }), CATALOG_SNAPSHOT)).toEqual({ ratio: 72, needWh: 209, inverterW: 3000, volts: 12, bankWh: 1200 })
  })

  test('a project with nothing selected gets no note', () => {
    expect(oversizeNote(project({}), CATALOG_SNAPSHOT)).toBeNull()
  })
})
