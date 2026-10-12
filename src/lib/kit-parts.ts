import { panelCount, tr, type Dictionary, type Locale } from '../i18n'
import { fmtInt, fmtKw, fmtKwh, fmtW } from '../i18n/format'
import { hasPanels, type CablePick, type ConductorKind, type SizingResult } from './sizing'
import { SOLAR } from './solar'

export interface Part { id: string; name: string; spec: string; note: string; qty: string; group?: 'solar' }

const KA = 1000
const CM_PER_M = 100
const joinNotes = (notes: readonly string[]) => notes.filter(Boolean).join(' · ')

/** Panels, controller, PV cable, disconnect and mounting, tagged so the table can mark them; nothing for a battery-only kit. */
function solarParts(r: SizingResult, t: Dictionary, locale: Locale): Part[] {
  if (!hasPanels(r)) return []
  const s = r.solar
  const strings = s.strings === 1 ? tr(t, 'stringsOne', { n: s.perString }) : tr(t, 'stringsMany', { strings: s.strings, n: s.perString })
  const panelW = `${SOLAR.PANEL_W} W`
  return [
    { id: 'solarPanels', group: 'solar', name: t.parts.solarPanels, spec: tr(t, 'solarPanelsSpec', { w: panelW, size: SOLAR.PANEL_SIZE }), note: tr(t, 'solarPanelsNote', { strings, kw: fmtKw(s.arrayW, locale), m2: s.roofUsedM2 }), qty: String(s.panels) },
    { id: 'chargeController', group: 'solar', name: t.parts.chargeController, spec: tr(t, 'chargeControllerSpec', { amps: s.controllerA, voc: SOLAR.CONTROLLER_MAX_VOC, volts: r.volts }), note: tr(t, 'chargeControllerNote', { chargeA: fmtInt(s.chargeA, locale), stringVoc: s.stringVoc }), qty: String(s.controllers) },
    { id: 'pvCable', group: 'solar', name: t.parts.pvCable, spec: tr(t, 'pvCableSpec', { mm2: SOLAR.PV_CABLE.mm2, awg: SOLAR.PV_CABLE.awg, length: s.pvRunM }), note: t.ui.pvCableNote, qty: String(s.pvCablePairs) },
    { id: 'pvDisconnect', group: 'solar', name: t.parts.pvDisconnect, spec: tr(t, 'pvDisconnectSpec', { amps: s.breakerA }), note: t.ui.pvDisconnectNote, qty: String(s.controllers) },
    { id: 'mounting', group: 'solar', name: t.parts.mounting, spec: tr(t, 'mountingSpec', { panels: panelCount(t, s.panels) }), note: t.ui.mountingNote, qty: '1' },
  ]
}

/**
 * Series links and, for parallel strings, the lead pair from each string to the bus bars. Each row prints the gauge,
 * design current and ampacity the engine put on `links` and `string`; in a one-string bank that is the main cable's
 * gauge, one jumper per main run.
 */
function bankWiringParts(c: CablePick, t: Dictionary, locale: Locale): Part[] {
  const a = (n: number) => fmtInt(n, locale)
  const cm = (m: number) => Math.round(m * CM_PER_M)
  const { links, string } = c
  return [
    ...(links
      ? [{
        id: 'interconnects' satisfies ConductorKind, name: t.parts.interconnects, spec: tr(t, 'interconnectsSpec', { gauge: links.gauge, cm: cm(links.lengthM) }),
        note: tr(t, links.perPosition > 1 ? 'seriesLinksSharedNote' : 'seriesLinksNote', { each: links.perPosition, amps: a(links.designA), ampacity: a(links.ampacity) }),
        qty: String(links.count),
      }]
      : []),
    ...(string
      ? [{
        id: 'stringLeads' satisfies ConductorKind, name: t.parts.stringLeads, spec: tr(t, 'stringLeadsSpec', { gauge: string.gauge, mm2: string.mm2, cm: cm(string.lengthM) }),
        note: tr(t, 'stringLeadsNote', { amps: a(string.designA), ampacity: a(string.ampacity) }), qty: String(string.leads),
      }]
      : []),
  ]
}

/** The parts list the screen, the sheet, the image and the CSV all share. Rows with nothing to buy are left out; solar rows come last. */
export function buildParts(r: SizingResult, t: Dictionary, locale: Locale): Part[] {
  const b = r.battery
  if (r.empty || !b) return []
  const c = r.cable
  const perRun = c.runs > 1 ? t.ui.perRun : ''
  const batteriesNote = joinNotes([
    tr(t, 'batteriesNote', { series: b.series, parallel: b.parallel, config: b.config, bank: fmtKwh(b.bankWh, locale), usable: fmtKwh(b.usableWh, locale) }),
    tr(t, 'batteriesCurrentNote', { cont: fmtInt(b.bankContinuousA, locale), peak: fmtInt(b.bankPeakA, locale) }),
    ...r.parallelNotes.map((n) => t.parallelNotes[n]),
  ])
  const w = (n: number) => fmtW(n, locale)
  const base: Part[] = [
    { id: 'inverter', name: t.parts.inverter, spec: tr(t, 'inverterSpec', { w: w(r.inverter.w), volts: r.volts }), note: tr(t, 'inverterNote', { surge: w(r.inverter.surge), running: w(r.runningW), peak: w(r.surgeW) }), qty: '1' },
    { id: 'batteries', name: t.parts.batteries, spec: b.unitLabel, note: batteriesNote, qty: String(b.count) },
    {
      id: 'mainCable' satisfies ConductorKind, name: t.parts.mainCable, spec: tr(t, 'mainCableSpec', { gauge: c.gauge, mm2: c.mm2, length: c.mainLengthM }),
      note: tr(t, 'mainCableNote', { amps: fmtInt(c.designPerRunA, locale), perRun: c.runs > 1 ? t.ui.perRun : '', ampacity: fmtInt(c.ampacity, locale), drop: c.startupDropPct }), qty: String(c.mainCount),
    },
    ...bankWiringParts(c, t, locale),
    {
      id: 'fuse', name: t.parts.fuse, spec: tr(t, 'fuseSpec', { amps: r.fuse.a, class: r.fuse.class, perRun }),
      note: joinNotes([t.ui.fuseNote, tr(t, 'fuseAicNote', { aic: r.fuse.aicA / KA })]), qty: String(r.fuse.count),
    },
    ...(c.string
      ? [{
        id: 'stringFuses', name: t.parts.stringFuses, spec: tr(t, 'stringFuseSpec', { amps: c.string.fuse.a, class: c.string.fuse.class }),
        note: t.ui.stringFuseNote, qty: String(c.string.fuse.count),
      }]
      : []),
  ]
  return [...base, ...solarParts(r, t, locale)]
}
