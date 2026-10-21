import type { Dictionary } from '../i18n'
import type { BatteryOption } from './sizing'
import { feedsInverter } from './sizing/battery'

/** The automatic row's title: the best fit only when its bank can feed the inverter, otherwise just Auto. */
export const autoTitle = (t: Dictionary, auto: BatteryOption): string =>
  feedsInverter(auto) ? `${t.ui.batteryAuto} · ${t.ui.batteryRecommended}` : t.ui.batteryAuto

/** The tags a battery row carries for what its bank fails: discharge, peak, more strings than its maker allows. */
export function batteryTags(t: Dictionary, o: BatteryOption): string[] {
  return [
    ...(o.dischargeOk ? [] : [t.ui.lowContinuous]),
    ...(o.peakOk ? [] : [t.ui.lowPeak]),
    ...(o.overMaxParallel ? [t.ui.manyStrings] : []),
  ]
}
