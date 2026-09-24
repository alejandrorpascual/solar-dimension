export type Appliance = { id: string; name: string; category: string; icon: string; watts: number; surge: number; duty: number }
export type Load = Appliance & { quantity: number }
export type Settings = { hours: number; voltage: 12 | 24 | 48; ah: number; efficiency: number; dod: number; margin: number; idle: number; powerFactor: number; bmsAmps: number; cableLength: number; branchLength: number; simultaneous: boolean }
export const defaults: Settings = { hours: 10, voltage: 48, ah: 100, efficiency: 90, dod: 80, margin: 25, idle: 15, powerFactor: 0.8, bmsAmps: 100, cableLength: 2, branchLength: 0.5, simultaneous: false }
export const appliances: Appliance[] = [
  { id: 'fridge', name: 'Refrigerator', category: 'Kitchen', icon: 'fridge', watts: 200, surge: 1200, duty: 40 },
  { id: 'lights', name: 'LED light', category: 'Living', icon: 'light', watts: 9, surge: 9, duty: 100 },
  { id: 'fan', name: 'Standing fan', category: 'Climate', icon: 'fan', watts: 55, surge: 110, duty: 100 },
  { id: 'router', name: 'Wi-Fi router', category: 'Work', icon: 'wifi', watts: 15, surge: 15, duty: 100 },
  { id: 'laptop', name: 'Laptop', category: 'Work', icon: 'laptop', watts: 65, surge: 65, duty: 100 },
  { id: 'tv', name: 'LED television', category: 'Living', icon: 'tv', watts: 100, surge: 100, duty: 100 },
  { id: 'ac', name: 'Air conditioner', category: 'Climate', icon: 'snow', watts: 1200, surge: 3600, duty: 60 },
  { id: 'freezer', name: 'Chest freezer', category: 'Kitchen', icon: 'fridge', watts: 150, surge: 900, duty: 40 },
  { id: 'microwave', name: 'Microwave', category: 'Kitchen', icon: 'microwave', watts: 1200, surge: 1500, duty: 5 },
  { id: 'coffee', name: 'Coffee maker', category: 'Kitchen', icon: 'coffee', watts: 1000, surge: 1000, duty: 5 },
  { id: 'desktop', name: 'Desktop + monitor', category: 'Work', icon: 'monitor', watts: 250, surge: 350, duty: 100 },
  { id: 'phone', name: 'Phone charger', category: 'Work', icon: 'phone', watts: 20, surge: 20, duty: 50 },
  { id: 'pump', name: 'Water pump', category: 'Utilities', icon: 'water', watts: 750, surge: 2250, duty: 15 },
  { id: 'washer', name: 'Washing machine', category: 'Utilities', icon: 'washer', watts: 500, surge: 1500, duty: 10 },
  { id: 'security', name: 'Security cameras', category: 'Utilities', icon: 'camera', watts: 30, surge: 30, duty: 100 },
  { id: 'speaker', name: 'Smart speaker', category: 'Living', icon: 'speaker', watts: 10, surge: 10, duty: 100 },
]
export const presets: Record<string, Record<string, number>> = {
  Essentials: { fridge: 1, lights: 6, fan: 2, router: 1, laptop: 1 },
  'Work from home': { fridge: 1, lights: 4, router: 1, laptop: 2, fan: 1, phone: 2 },
  'More comfort': { fridge: 1, lights: 8, router: 1, laptop: 1, tv: 1, ac: 1 },
}
export function presetLoads(name: string): Load[] { return Object.entries(presets[name]).map(([id, quantity]) => ({ ...appliances.find(a => a.id === id)!, quantity })) }
const bounded = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
export function validSettings(s: unknown): s is Settings {
  if (!s || typeof s !== 'object') return false
  const v = s as Settings
  return [12, 24, 48].includes(v.voltage) && bounded(v.hours, 1, 72) && bounded(v.ah, 20, 1000) && bounded(v.efficiency, 60, 99) && bounded(v.dod, 20, 95) && bounded(v.margin, 0, 100) && bounded(v.idle, 0, 200) && bounded(v.powerFactor, 0.5, 1) && bounded(v.bmsAmps, 10, 500) && bounded(v.cableLength, 0.25, 30) && bounded(v.branchLength, 0.25, 10) && typeof v.simultaneous === 'boolean'
}
export function validLoads(value: unknown): value is Load[] {
  return Array.isArray(value) && value.length <= 100 && value.every(l => l && typeof l.id === 'string' && typeof l.name === 'string' && l.name.length > 0 && l.name.length <= 80 && typeof l.category === 'string' && typeof l.icon === 'string' && bounded(l.watts, 1, 20000) && bounded(l.surge, l.watts, 100000) && bounded(l.duty, 1, 100) && bounded(l.quantity, 1, 100) && Number.isInteger(l.quantity)) && new Set(value.map(l => l.id)).size === value.length
}
// AWG copper cross sections; this is a voltage-drop estimate, not an ampacity approval.
const gauges = [{ awg: '10', mm2: 5.26 }, { awg: '8', mm2: 8.37 }, { awg: '6', mm2: 13.3 }, { awg: '4', mm2: 21.2 }, { awg: '2', mm2: 33.6 }, { awg: '1', mm2: 42.4 }, { awg: '1/0', mm2: 53.5 }, { awg: '2/0', mm2: 67.4 }, { awg: '3/0', mm2: 85 }, { awg: '4/0', mm2: 107 }]
export function cableEstimate(amps: number, length: number, voltage: number) {
  const area = 2 * length * 0.0213 * amps / (voltage * 0.02)
  const gauge = gauges.find(g => g.mm2 >= area) ?? null
  return { gauge, area, drop: gauge ? 2 * length * 0.0213 * amps / gauge.mm2 / voltage * 100 : null }
}
export function calculate(loads: Load[], settings: Settings) {
  if (!validSettings(settings) || !validLoads(loads)) throw new Error('Invalid sizing inputs')
  const running = loads.reduce((sum, l) => sum + l.watts * l.quantity, 0)
  const average = loads.reduce((sum, l) => sum + l.watts * l.quantity * l.duty / 100, 0)
  // Staggered starts: one physical appliance starts while all others run.
  const extra = settings.simultaneous ? loads.reduce((sum, l) => sum + (l.surge - l.watts) * l.quantity, 0) : Math.max(0, ...loads.map(l => l.surge - l.watts))
  const surge = running + extra
  const continuousMinimum = running * (1 + settings.margin / 100)
  const sizes = [500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000]
  const inverter = running ? sizes.find(size => size >= continuousMinimum) ?? Math.ceil(continuousMinimum / 1000) * 1000 : 0
  const minSurge = Math.max(inverter, surge)
  const nominal = settings.voltage * 16 / 15 // LiFePO4: 12.8, 25.6, 51.2 V, native voltage modules.
  const lowVoltage = settings.voltage * 0.9
  const dcWatts = average ? average / (settings.efficiency / 100) + settings.idle : 0
  const energy = average * settings.hours / 1000
  const batteryRequired = dcWatts * settings.hours / (settings.dod / 100) / 1000
  const moduleKwh = nominal * settings.ah / 1000
  const dcAmps = inverter ? (inverter / (settings.efficiency / 100) + settings.idle) / lowVoltage : 0
  const surgeAmps = inverter ? (minSurge / (settings.efficiency / 100) + settings.idle) / lowVoltage : 0
  const energyCount = Math.ceil(batteryRequired / moduleKwh)
  // No assumed BMS pulse rating: use continuous current even for the estimated surge.
  const powerCount = Math.ceil(Math.max(dcAmps, surgeAmps) / settings.bmsAmps)
  const count = Math.max(energyCount, powerCount)
  const bankKwh = count * moduleKwh
  const runtime = dcWatts ? bankKwh * 1000 * settings.dod / 100 / dcWatts : 0
  const mainCable = cableEstimate(dcAmps, settings.cableLength, lowVoltage)
  const branchCable = cableEstimate(count ? dcAmps / count : 0, settings.branchLength, lowVoltage)
  const cableCount = count ? 2 + count * 2 : 0
  const totalCable = count ? (2 * settings.cableLength + 2 * count * settings.branchLength) * 1.1 : 0
  const va = inverter / settings.powerFactor
  const preferHigherVoltage = settings.voltage === 12 && va > 3000 || settings.voltage === 24 && va > 5000
  return { running, average, surge, inverter, minSurge, va, energy, nominal, lowVoltage, dcWatts, batteryRequired, moduleKwh, dcAmps, surgeAmps, energyCount, powerCount, count, bankKwh, runtime, mainCable, branchCable, cableCount, totalCable, preferHigherVoltage }
}
